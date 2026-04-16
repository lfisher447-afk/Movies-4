'use strict';
// ═══════════════════════════════════════════════════════════════
//  BingeBox Omega — api-proxy.js  (NEW — Advanced v10.1)
// ═══════════════════════════════════════════════════════════════

const https = require('https');
const express = require('express');

const router = express.Router();

// ── Config ───────────────────────────────────────────────────────
const TMDB_BASE    = 'https://api.themoviedb.org/3';
const TMDB_KEY     = process.env.TMDB_API_KEY || '15d2ea6d0dc1d476efbca3eba2b9bbfb';
const REQUEST_TIMEOUT = 8000;   
const MAX_RETRIES     = 2;
const BACKOFF_BASE    = 300;    

// ── TTL map per path prefix ─────────────────────────────────────
const TTL_MAP = new Map([
  ['/trending',  60 * 1000],        
  ['/search',    90 * 1000],        
  ['/discover',  3 * 60 * 1000],    
  ['/movie',     10 * 60 * 1000],   
  ['/tv',        10 * 60 * 1000],
  ['/genre',     60 * 60 * 1000],   
  ['/person',    30 * 60 * 1000],
]);

function getTTL(path) {
  for (const [prefix, ttl] of TTL_MAP) {
    if (path.startsWith(prefix)) return ttl;
  }
  return 5 * 60 * 1000; 
}

// ── Two-tier cache ──────────────────────────────────────────────
class LRUCache {
  constructor(maxSize = 300) {
    this._map  = new Map();
    this._max  = maxSize;
    this.hits  = 0;
    this.misses = 0;
  }
  get(key) {
    if (!this._map.has(key)) { this.misses++; return null; }
    const entry = this._map.get(key);
    if (Date.now() > entry.expires) { this._map.delete(key); this.misses++; return null; }
    this._map.delete(key);
    this._map.set(key, entry);
    this.hits++;
    return entry.data;
  }
  set(key, data, ttl) {
    if (this._map.size >= this._max) {
      this._map.delete(this._map.keys().next().value);
    }
    this._map.set(key, { data, expires: Date.now() + ttl });
  }
  clear() { this._map.clear(); }
  get size() { return this._map.size; }
  stats() {
    return { size: this.size, hits: this.hits, misses: this.misses, hitRate: this.hits / Math.max(1, this.hits + this.misses) };
  }
}

const L1 = new LRUCache(300); 
const L2 = new LRUCache(1000); 

// ── In-flight deduplication ─────────────────────────────────────
const inFlight = new Map(); 

// ── Circuit breaker ─────────────────────────────────────────────
const circuit = {
  failures:   0,
  lastFailure: 0,
  threshold:  10,       
  resetAfter: 60000,    
  isOpen() {
    if (this.failures < this.threshold) return false;
    if (Date.now() - this.lastFailure > this.resetAfter) {
      this.failures = 0;
      return false;
    }
    return true;
  },
  record(ok) {
    if (ok) { this.failures = 0; }
    else    { this.failures++; this.lastFailure = Date.now(); }
  },
};

// ── HTTPS fetch with retry ───────────────────────────────────────
function tmdbFetch(path, params = {}, attempt = 0) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({ api_key: TMDB_KEY, ...params }).toString();
    
    // Crucial fix: Sanitize path to prevent TMDB returning 404s for double slashes
    const cleanPath = '/' + path.replace(/^\/+/, '');
    const url = `${TMDB_BASE}${cleanPath}?${qs}`;

    const req = https.get(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'BingeBox-Omega/10.1' },
      timeout: REQUEST_TIMEOUT,
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 429 && attempt < MAX_RETRIES) {
          const wait = BACKOFF_BASE * Math.pow(2, attempt);
          return setTimeout(() => tmdbFetch(path, params, attempt + 1).then(resolve).catch(reject), wait);
        }
        
        // Pass the actual TMDB status code back to avoid forcing 502s
        if (res.statusCode >= 400) {
          circuit.record(false);
          const err = new Error(`TMDB ${res.statusCode}: ${cleanPath}`);
          err.status = res.statusCode;
          return reject(err);
        }
        
        try {
          const data = JSON.parse(body);
          circuit.record(true);
          resolve(data);
        } catch (e) {
          circuit.record(false);
          const err = new Error('TMDB JSON parse error');
          err.status = 502; // Valid 502, proxy failed to parse upstream response
          reject(err);
        }
      });
    });

    req.on('error', err => {
      circuit.record(false);
      if (err.message === 'socket hang up' || err.code === 'ECONNRESET') {
          if (attempt < MAX_RETRIES) {
            const wait = BACKOFF_BASE * Math.pow(2, attempt);
            return setTimeout(() => tmdbFetch(path, params, attempt + 1).then(resolve).catch(reject), wait);
          }
      }
      err.status = 502;
      reject(err);
    });

    req.on('timeout', () => {
      // Don't trigger standard error handler loop, manually reject
      req.destroy();
      circuit.record(false);
      const err = new Error(`TMDB request timeout: ${cleanPath}`);
      err.status = 504; // Gateway Timeout
      reject(err);
    });
  });
}

// ── Cached + deduplicated fetch ──────────────────────────────────
async function cachedFetch(path, params = {}) {
  const cacheKey = `${path}?${new URLSearchParams(params).toString()}`;
  const ttl      = getTTL(path);

  const l1 = L1.get(cacheKey);
  if (l1) return { data: l1, source: 'L1' };

  const l2 = L2.get(cacheKey);
  if (l2) {
    L1.set(cacheKey, l2, ttl / 2); 
    return { data: l2, source: 'L2' };
  }

  if (circuit.isOpen()) {
    const err = new Error('Circuit breaker OPEN — TMDB temporarily unavailable');
    err.status = 503;
    throw err;
  }

  if (inFlight.has(cacheKey)) {
    const data = await inFlight.get(cacheKey);
    return { data, source: 'DEDUP' };
  }

  const promise = tmdbFetch(path, params)
    .then(data => {
      L1.set(cacheKey, data, ttl);
      L2.set(cacheKey, data, ttl * 3);
      inFlight.delete(cacheKey);
      return data;
    })
    .catch(err => {
      inFlight.delete(cacheKey);
      throw err;
    });

  inFlight.set(cacheKey, promise);
  const data = await promise;
  return { data, source: 'FETCH' };
}

// ═══════════════════════════════════════════════════════════════
//  Express Routes
// ═══════════════════════════════════════════════════════════════

router.get('/tmdb/*', async (req, res) => {
  const tmdbPath = '/' + req.params[0];

  const params = { ...req.query };
  delete params.api_key; 

  try {
    const { data, source } = await cachedFetch(tmdbPath, params);
    res.setHeader('X-BingeBox-Cache', source);
    res.setHeader('Cache-Control', `public, max-age=${Math.floor(getTTL(tmdbPath) / 1000)}`);
    res.json(data);
  } catch (err) {
    // Utilize the exact status from TMDB rather than defaulting to 502
    const status = err.status || 502;
    res.status(status).json({ error: 'tmdb_error', message: err.message });
  }
});

router.post('/tmdb/batch', express.json(), async (req, res) => {
  const { requests } = req.body || {};
  if (!Array.isArray(requests) || requests.length > 10) {
    return res.status(400).json({ error: 'bad_request', message: 'Provide 1–10 requests.' });
  }

  const results = await Promise.allSettled(
    requests.map(({ path: p, params }) => cachedFetch(p, params || {}))
  );

  res.json({
    results: results.map((r, i) => ({
      path:   requests[i].path,
      status: r.status === 'fulfilled' ? 'ok' : 'error',
      data:   r.status === 'fulfilled' ? r.value.data : null,
      error:  r.status === 'rejected'  ? r.reason.message : null,
      source: r.status === 'fulfilled' ? r.value.source : null,
    })),
  });
});

router.get('/tmdb/cache-info', (req, res) => {
  res.json({
    l1: L1.stats(),
    l2: L2.stats(),
    inFlight: inFlight.size,
    circuit: {
      failures:  circuit.failures,
      threshold: circuit.threshold,
      isOpen:    circuit.isOpen(),
    },
  });
});

router.delete('/tmdb/cache', (req, res) => {
  const l1Size = L1.size;
  const l2Size = L2.size;
  L1.clear();
  L2.clear();
  res.json({ cleared: { l1: l1Size, l2: l2Size } });
});

module.exports = router;
module.exports.cachedFetch = cachedFetch;
module.exports.L1 = L1;
module.exports.L2 = L2;
module.exports.circuit = circuit;
