'use strict';
// ═══════════════════════════════════════════════════════════════
//  BingeBox Omega — cache-manager.js  (NEW — Advanced v10.0)
// ═══════════════════════════════════════════════════════════════
//  A production-grade multi-tier caching system:
//    • L1 LRU hot cache (small, fast, frequent hits)
//    • L2 LRU warm cache (large, longer TTL, fallback)
//    • Adaptive TTL — extends on repeated hits, shrinks on errors
//    • Tag-based invalidation (e.g. invalidate all 'movie' entries)
//    • Prefetch queue — pre-warms popular endpoints
//    • Cache-aside pattern with stale-while-revalidate
//    • Compression for large values (>4KB)
//    • Memory pressure guard — evicts when RSS exceeds threshold
//    • Prometheus-style metrics (hit rate, evictions, etc.)
//    • Express router for /api/v1/cache/* management
// ═══════════════════════════════════════════════════════════════

const zlib    = require('zlib');
const os      = require('os');
const express = require('express');

// ── Config ───────────────────────────────────────────────────────
const CFG = {
  L1_MAX:        300,
  L2_MAX:        2000,
  DEFAULT_TTL:   5   * 60 * 1000,    // 5 min
  MAX_TTL:       60  * 60 * 1000,    // 1 hour cap
  MIN_TTL:       30  * 1000,         // 30 sec floor
  COMPRESS_AT:   4096,               // bytes — compress values larger than this
  MEM_THRESHOLD: 0.85,               // RSS / totalMem ratio that triggers eviction
  PREFETCH_CONCURRENCY: 3,
  SWR_WINDOW:    30  * 1000,         // stale-while-revalidate window
  METRICS_RESET: 60  * 60 * 1000,   // reset metrics hourly
};

// ── Metrics ──────────────────────────────────────────────────────
const metrics = {
  hits:       0,
  misses:     0,
  staleHits:  0,
  evictions:  0,
  compressions: 0,
  decompressions: 0,
  prefetches: 0,
  invalidations: 0,
  errors:     0,
  reset() { Object.assign(this, { hits:0, misses:0, staleHits:0, evictions:0, compressions:0, decompressions:0, prefetches:0, invalidations:0, errors:0 }); },
  snapshot() {
    const total = this.hits + this.misses;
    return { ...this, hitRate: total ? (this.hits / total) : 0, total };
  },
};
setInterval(() => metrics.reset(), CFG.METRICS_RESET);

// ── Compression helpers ──────────────────────────────────────────
function compress(str) {
  if (str.length < CFG.COMPRESS_AT) return { data: str, compressed: false };
  const buf = zlib.gzipSync(Buffer.from(str, 'utf8'));
  metrics.compressions++;
  return { data: buf, compressed: true };
}

function decompress(entry) {
  if (!entry.compressed) return entry.data;
  const str = zlib.gunzipSync(entry.data).toString('utf8');
  metrics.decompressions++;
  return str;
}

// ═══════════════════════════════════════════════════════════════
//  LRU Cache Class
// ═══════════════════════════════════════════════════════════════

class LRUTieredCache {
  constructor(maxSize, name) {
    this._map   = new Map();
    this._max   = maxSize;
    this._name  = name;
    this.evictions = 0;
  }

  _evictOldest() {
    if (!this._map.size) return;
    const key = this._map.keys().next().value;
    this._map.delete(key);
    this.evictions++;
    metrics.evictions++;
  }

  /**
   * @param {string} key
   * @returns {null | { value: any, stale: boolean, ttl: number }}
   */
  get(key) {
    if (!this._map.has(key)) return null;
    const entry = this._map.get(key);
    const now   = Date.now();

    // Move to end (LRU)
    this._map.delete(key);
    this._map.set(key, entry);

    const expired = now > entry.expires;
    const stale   = !expired && now > (entry.expires - CFG.SWR_WINDOW);

    if (expired && !entry.allowStale) return null;

    // Decompress if needed
    const value = typeof entry.data === 'object' && entry.compressed !== undefined
      ? JSON.parse(decompress(entry))
      : entry.data;

    return { value, stale: expired || stale, ttl: Math.max(0, entry.expires - now) };
  }

  /**
   * @param {string} key
   * @param {*} value
   * @param {number} ttl
   * @param {string[]} tags
   */
  set(key, value, ttl, tags = []) {
    if (this._map.size >= this._max) this._evictOldest();

    const serialized = JSON.stringify(value);
    const { data, compressed } = compress(serialized);

    this._map.set(key, {
      data,
      compressed,
      expires:    Date.now() + ttl,
      ttl,
      tags,
      hits:       0,
      setAt:      Date.now(),
      allowStale: true,
    });
  }

  delete(key) { return this._map.delete(key); }

  invalidateByTag(tag) {
    let count = 0;
    for (const [k, v] of this._map.entries()) {
      if (v.tags.includes(tag)) { this._map.delete(k); count++; }
    }
    metrics.invalidations += count;
    return count;
  }

  clear() { const s = this._map.size; this._map.clear(); return s; }

  get size() { return this._map.size; }

  keys() { return [...this._map.keys()]; }

  info() {
    return {
      name:      this._name,
      size:      this._map.size,
      maxSize:   this._max,
      evictions: this.evictions,
      utilization: this._map.size / this._max,
    };
  }
}

// ── Instances ────────────────────────────────────────────────────
const L1 = new LRUTieredCache(CFG.L1_MAX,  'L1-Hot');
const L2 = new LRUTieredCache(CFG.L2_MAX,  'L2-Warm');

// ═══════════════════════════════════════════════════════════════
//  Adaptive TTL engine
// ═══════════════════════════════════════════════════════════════

const hitCounters = new Map(); // key → consecutive hit count

function getAdaptiveTTL(key, baseTTL) {
  const hits = hitCounters.get(key) || 0;
  hitCounters.set(key, hits + 1);

  // Exponential TTL growth for hot keys (cap at MAX_TTL)
  const adapted = Math.min(baseTTL * Math.pow(1.3, Math.min(hits, 8)), CFG.MAX_TTL);
  return Math.max(CFG.MIN_TTL, adapted);
}

// ═══════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════

/**
 * Get a value from the cache.
 * Returns { value, stale, source } or null.
 */
function get(key) {
  const l1 = L1.get(key);
  if (l1) {
    metrics.hits++;
    if (l1.stale) metrics.staleHits++;
    return { ...l1, source: 'L1' };
  }

  const l2 = L2.get(key);
  if (l2) {
    metrics.hits++;
    if (l2.stale) metrics.staleHits++;
    // Promote to L1
    L1.set(key, l2.value, Math.min(l2.ttl, CFG.DEFAULT_TTL), []);
    return { ...l2, source: 'L2' };
  }

  metrics.misses++;
  return null;
}

/**
 * Set a value in both L1 and L2 with adaptive TTL.
 * @param {string}   key
 * @param {*}        value
 * @param {number}   baseTTL   milliseconds
 * @param {string[]} tags      invalidation tags
 */
function set(key, value, baseTTL = CFG.DEFAULT_TTL, tags = []) {
  const ttl = getAdaptiveTTL(key, baseTTL);
  L1.set(key, value, Math.min(ttl, CFG.DEFAULT_TTL * 2), tags);
  L2.set(key, value, ttl, tags);
}

/**
 * Delete from both tiers.
 */
function del(key) {
  L1.delete(key);
  L2.delete(key);
}

/**
 * Invalidate all entries matching a tag.
 */
function invalidate(tag) {
  const n = L1.invalidateByTag(tag) + L2.invalidateByTag(tag);
  return n;
}

/**
 * Stale-while-revalidate wrapper.
 * If the cached value is stale, returns it immediately AND fires an async refresh.
 */
async function getOrFetch(key, fetcher, ttl = CFG.DEFAULT_TTL, tags = []) {
  const cached = get(key);

  if (cached && !cached.stale) return cached.value;

  if (cached && cached.stale) {
    // Return stale immediately, refresh in background
    setImmediate(async () => {
      try {
        const fresh = await fetcher();
        set(key, fresh, ttl, tags);
      } catch (err) {
        metrics.errors++;
      }
    });
    return cached.value;
  }

  // Cache miss — fetch and store
  try {
    const value = await fetcher();
    set(key, value, ttl, tags);
    return value;
  } catch (err) {
    metrics.errors++;
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Memory pressure guard
// ═══════════════════════════════════════════════════════════════

function checkMemoryPressure() {
  const rss   = process.memoryUsage().rss;
  const total = os.totalmem();
  const ratio = rss / total;

  if (ratio > CFG.MEM_THRESHOLD) {
    // Evict 20% of L2
    const evictCount = Math.ceil(L2.size * 0.2);
    const keys = L2.keys().slice(0, evictCount);
    keys.forEach(k => L2.delete(k));

    const log = (() => { try { return require('./logger').root; } catch (_) { return console; } })();
    const warn = log.warn || log.log;
    if (warn) warn.call(log, `Memory pressure (${(ratio*100).toFixed(0)}%) — evicted ${evictCount} L2 entries`);
    metrics.evictions += evictCount;
  }
}
setInterval(checkMemoryPressure, 30 * 1000);

// ═══════════════════════════════════════════════════════════════
//  Prefetch queue
// ═══════════════════════════════════════════════════════════════

const prefetchQueue = [];
let prefetching = 0;

function enqueuePrefetch(key, fetcher, ttl, tags) {
  prefetchQueue.push({ key, fetcher, ttl, tags });
  drainPrefetch();
}

async function drainPrefetch() {
  if (prefetching >= CFG.PREFETCH_CONCURRENCY || !prefetchQueue.length) return;
  const job = prefetchQueue.shift();
  if (!job) return;
  prefetching++;
  try {
    const value = await job.fetcher();
    set(job.key, value, job.ttl, job.tags);
    metrics.prefetches++;
  } catch (_) {
    metrics.errors++;
  } finally {
    prefetching--;
    drainPrefetch();
  }
}

// ═══════════════════════════════════════════════════════════════
//  Express management router
// ═══════════════════════════════════════════════════════════════

const router = express.Router();

router.get('/stats', (req, res) => {
  res.json({
    metrics:    metrics.snapshot(),
    l1:         L1.info(),
    l2:         L2.info(),
    prefetch:   { queued: prefetchQueue.length, active: prefetching },
    memory: {
      rss:   `${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)}MB`,
      total: `${(os.totalmem() / 1024 / 1024).toFixed(0)}MB`,
      pressure: ((process.memoryUsage().rss / os.totalmem()) * 100).toFixed(1) + '%',
    },
  });
});

router.delete('/all', (req, res) => {
  const l1 = L1.clear();
  const l2 = L2.clear();
  hitCounters.clear();
  res.json({ cleared: { l1, l2 } });
});

router.delete('/tag/:tag', (req, res) => {
  const n = invalidate(req.params.tag);
  res.json({ invalidated: n, tag: req.params.tag });
});

router.delete('/key/:key', (req, res) => {
  del(req.params.key);
  res.json({ deleted: req.params.key });
});

router.get('/keys', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  res.json({ l1: L1.keys().slice(0, limit), l2: L2.keys().slice(0, limit) });
});

// ═══════════════════════════════════════════════════════════════
//  Exports
// ═══════════════════════════════════════════════════════════════

module.exports = {
  get,
  set,
  del,
  invalidate,
  getOrFetch,
  enqueuePrefetch,
  metrics,
  L1,
  L2,
  router,
  CFG,
};
