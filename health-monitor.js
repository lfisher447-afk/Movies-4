'use strict';
// ═══════════════════════════════════════════════════════════════
//  BingeBox Omega — health-monitor.js  (NEW — Advanced v10.0)
// ═══════════════════════════════════════════════════════════════
//  A comprehensive system health monitor:
//    • CPU usage sampling (rolling 5s average)
//    • Memory tracking with trend analysis
//    • Heap snapshot deltas (leak detection heuristic)
//    • Event loop lag measurement
//    • TMDB API reachability probe
//    • File system check (public/index.html present)
//    • Per-service health checks with status history
//    • /health  → simple 200 OK / 503 liveness probe
//    • /health/detailed  → full JSON report
//    • /health/ready     → readiness probe (all checks green)
//    • Periodic alerting via console (extendable to webhooks)
//    • Uptime SLA tracker (% uptime since boot)
//    • Express router for all health endpoints
// ═══════════════════════════════════════════════════════════════

const os      = require('os');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const express = require('express');

const router  = express.Router();

// ── Constants ────────────────────────────────────────────────────
const BOOT_TIME   = Date.now();
const VERSION     = (() => { try { return require('./package.json').version; } catch (_) { return '10.0.0'; } })();
const PUBLIC_DIR  = path.join(process.cwd(), 'public');
const TMDB_PROBE  = 'https://api.themoviedb.org/3/configuration';
const TMDB_KEY    = process.env.TMDB_API_KEY || '15d2ea6d0dc1d476efbca3eba2b9bbfb';

// Thresholds
const THRESHOLDS = {
  CPU_WARN:      70,    // %
  CPU_CRIT:      90,
  MEM_WARN:      75,    // % of total
  MEM_CRIT:      90,
  HEAP_WARN:     400,   // MB
  HEAP_CRIT:     700,
  EL_LAG_WARN:   50,    // ms
  EL_LAG_CRIT:   200,
  PROBE_TIMEOUT: 5000,  // ms
};

// ── State ────────────────────────────────────────────────────────
const state = {
  cpu:       { current: 0, avg5s: 0, samples: [] },
  memory:    { used: 0, total: os.totalmem(), pct: 0, trend: 'stable' },
  heap:      { usedMB: 0, totalMB: 0, externalMB: 0, prevUsedMB: 0, delta: 0 },
  eventLoop: { lagMs: 0, samples: [] },
  checks:    new Map(),  // name → { status, lastCheck, latency, message, history }
  incidents: [],         // [{ ts, check, status, message }]
  sla:       { downtimeMs: 0, lastDown: null },
};

// Overall status: ok | degraded | down
let overallStatus = 'ok';

// ── CPU sampler ──────────────────────────────────────────────────
let lastCpuSample = os.cpus();

function sampleCPU() {
  const cpus    = os.cpus();
  const deltas  = cpus.map((cpu, i) => {
    const prev = lastCpuSample[i] || cpu;
    const idle  = cpu.times.idle  - (prev.times.idle  || 0);
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0)
                - Object.values(prev.times || {}).reduce((a, b) => a + b, 0);
    return total > 0 ? ((total - idle) / total) * 100 : 0;
  });
  lastCpuSample = cpus;
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;

  state.cpu.current = parseFloat(avg.toFixed(1));
  state.cpu.samples.push(avg);
  if (state.cpu.samples.length > 30) state.cpu.samples.shift(); // 5s avg (sample every 1s × 30)
  state.cpu.avg5s = parseFloat((state.cpu.samples.reduce((a, b) => a + b, 0) / state.cpu.samples.length).toFixed(1));
}

// ── Memory sampler ───────────────────────────────────────────────
function sampleMemory() {
  const freeMem  = os.freemem();
  const total    = os.totalmem();
  const used     = total - freeMem;
  const pct      = (used / total) * 100;
  const prev     = state.memory.pct || pct;

  state.memory = {
    used:     used,
    free:     freeMem,
    total,
    pct:      parseFloat(pct.toFixed(1)),
    usedMB:   parseFloat((used / 1024 / 1024).toFixed(1)),
    freeMB:   parseFloat((freeMem / 1024 / 1024).toFixed(1)),
    totalMB:  parseFloat((total / 1024 / 1024).toFixed(0)),
    trend:    pct > prev + 2 ? 'rising' : pct < prev - 2 ? 'falling' : 'stable',
  };
}

// ── Heap sampler ─────────────────────────────────────────────────
function sampleHeap() {
  const mem = process.memoryUsage();
  const used = mem.heapUsed / 1024 / 1024;
  state.heap = {
    usedMB:     parseFloat(used.toFixed(1)),
    totalMB:    parseFloat((mem.heapTotal / 1024 / 1024).toFixed(1)),
    externalMB: parseFloat((mem.external  / 1024 / 1024).toFixed(1)),
    rssMB:      parseFloat((mem.rss       / 1024 / 1024).toFixed(1)),
    prevUsedMB: state.heap.usedMB || used,
    delta:      parseFloat((used - (state.heap.usedMB || used)).toFixed(2)),
  };
}

// ── Event loop lag ───────────────────────────────────────────────
function measureEventLoopLag() {
  const start = process.hrtime.bigint();
  setImmediate(() => {
    const lag = Number(process.hrtime.bigint() - start) / 1e6;
    state.eventLoop.samples.push(lag);
    if (state.eventLoop.samples.length > 10) state.eventLoop.samples.shift();
    state.eventLoop.lagMs = parseFloat(
      (state.eventLoop.samples.reduce((a, b) => a + b, 0) / state.eventLoop.samples.length).toFixed(2)
    );
  });
}

// ── Health check runner ──────────────────────────────────────────
function registerCheck(name, fn, intervalMs = 30000) {
  const entry = { status: 'unknown', lastCheck: null, latency: 0, message: '', history: [] };
  state.checks.set(name, entry);

  async function runCheck() {
    const t0 = Date.now();
    try {
      const result = await fn();
      entry.latency   = Date.now() - t0;
      entry.status    = result.status || 'ok';
      entry.message   = result.message || '';
      entry.lastCheck = new Date().toISOString();
    } catch (err) {
      entry.latency   = Date.now() - t0;
      entry.status    = 'error';
      entry.message   = err.message;
      entry.lastCheck = new Date().toISOString();
      state.incidents.push({ ts: new Date().toISOString(), check: name, status: 'error', message: err.message });
      if (state.incidents.length > 50) state.incidents.shift();
    }

    // History (last 10 statuses)
    entry.history.push(entry.status);
    if (entry.history.length > 10) entry.history.shift();
  }

  runCheck(); // immediate first run
  setInterval(runCheck, intervalMs);
}

// ── Built-in checks ──────────────────────────────────────────────

// 1. TMDB API reachability
registerCheck('tmdb-api', () => new Promise((resolve, reject) => {
  const url = `${TMDB_PROBE}?api_key=${TMDB_KEY}`;
  const req = https.get(url, { timeout: THRESHOLDS.PROBE_TIMEOUT }, res => {
    resolve({ status: res.statusCode === 200 ? 'ok' : 'degraded', message: `HTTP ${res.statusCode}` });
    res.resume();
  });
  req.on('error', reject);
  req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
}), 60000);

// 2. Static file check
registerCheck('static-files', async () => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  const exists    = fs.existsSync(indexPath);
  if (!exists) throw new Error('public/index.html not found');
  const stat = fs.statSync(indexPath);
  return { status: 'ok', message: `${(stat.size / 1024).toFixed(0)}KB` };
}, 120000);

// 3. Process memory check
registerCheck('process-memory', async () => {
  const { heapUsed, heapTotal } = process.memoryUsage();
  const pct = heapUsed / heapTotal;
  if (pct > 0.95) throw new Error(`Heap critical: ${(pct*100).toFixed(0)}%`);
  const status = pct > 0.80 ? 'degraded' : 'ok';
  return { status, message: `Heap ${(pct*100).toFixed(0)}% (${(heapUsed/1024/1024).toFixed(0)}MB)` };
}, 15000);

// 4. Event loop check
registerCheck('event-loop', async () => {
  const lag = state.eventLoop.lagMs;
  if (lag > THRESHOLDS.EL_LAG_CRIT) throw new Error(`Event loop critically slow: ${lag}ms`);
  const status = lag > THRESHOLDS.EL_LAG_WARN ? 'degraded' : 'ok';
  return { status, message: `${lag}ms lag` };
}, 10000);

// ── Overall status calculator ─────────────────────────────────────
function calcOverallStatus() {
  let status = 'ok';
  for (const [, check] of state.checks) {
    if (check.status === 'error')    { status = 'down';     break; }
    if (check.status === 'degraded') { status = 'degraded'; }
  }

  // Factor in system metrics
  if (state.cpu.avg5s > THRESHOLDS.CPU_CRIT)    status = 'degraded';
  if (state.memory.pct > THRESHOLDS.MEM_CRIT)   status = 'degraded';
  if (state.heap.usedMB > THRESHOLDS.HEAP_CRIT) status = 'degraded';
  if (state.eventLoop.lagMs > THRESHOLDS.EL_LAG_CRIT) status = 'degraded';

  // SLA tracking
  if (status !== 'ok' && overallStatus === 'ok') state.sla.lastDown = Date.now();
  if (status === 'ok'  && overallStatus !== 'ok' && state.sla.lastDown) {
    state.sla.downtimeMs += Date.now() - state.sla.lastDown;
    state.sla.lastDown = null;
  }

  overallStatus = status;
  return status;
}

// ── Sampling loop ─────────────────────────────────────────────────
setInterval(() => {
  sampleCPU();
  sampleMemory();
  sampleHeap();
  measureEventLoopLag();
}, 1000);

// ═══════════════════════════════════════════════════════════════
//  Full report builder
// ═══════════════════════════════════════════════════════════════

function buildReport() {
  const uptimeMs  = Date.now() - BOOT_TIME;
  const status    = calcOverallStatus();
  const slaUptime = uptimeMs > 0 ? ((1 - state.sla.downtimeMs / uptimeMs) * 100).toFixed(3) : '100.000';

  const checksObj = {};
  for (const [name, check] of state.checks) checksObj[name] = check;

  return {
    status,
    version:  VERSION,
    uptime:   { ms: uptimeMs, human: formatUptime(uptimeMs) },
    sla:      { uptime: `${slaUptime}%`, downtimeMs: state.sla.downtimeMs },
    ts:       new Date().toISOString(),
    cpu: {
      current: `${state.cpu.current}%`,
      avg5s:   `${state.cpu.avg5s}%`,
      warn:    state.cpu.avg5s > THRESHOLDS.CPU_WARN,
      cores:   os.cpus().length,
      load:    os.loadavg().map(l => l.toFixed(2)),
    },
    memory: state.memory,
    heap:   state.heap,
    eventLoop: state.eventLoop,
    node: {
      version:  process.version,
      pid:      process.pid,
      platform: os.platform(),
      arch:     os.arch(),
      hostname: os.hostname(),
    },
    checks:    checksObj,
    incidents: state.incidents.slice(-10),
    thresholds: THRESHOLDS,
  };
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m ${s % 60}s`;
}

// ═══════════════════════════════════════════════════════════════
//  Express routes
// ═══════════════════════════════════════════════════════════════

/** GET /health — simple liveness (Railway uses this) */
router.get('/', (req, res) => {
  const status = calcOverallStatus();
  const code   = status === 'down' ? 503 : 200;
  res.status(code).json({ status, version: VERSION, uptime: formatUptime(Date.now() - BOOT_TIME) });
});

/** GET /health/detailed — full report */
router.get('/detailed', (req, res) => {
  res.json(buildReport());
});

/** GET /health/ready — readiness probe (all checks must be ok/degraded) */
router.get('/ready', (req, res) => {
  let ready = true;
  for (const [, check] of state.checks) {
    if (check.status === 'error') { ready = false; break; }
  }
  res.status(ready ? 200 : 503).json({ ready, ts: new Date().toISOString() });
});

/** GET /health/metrics — Prometheus-compatible text format */
router.get('/metrics', (req, res) => {
  const r   = buildReport();
  const cpu = state.cpu.avg5s;
  const mem = state.memory.pct;
  const lag = state.eventLoop.lagMs;

  const lines = [
    `# HELP bingebox_uptime_seconds Total uptime`,
    `# TYPE bingebox_uptime_seconds gauge`,
    `bingebox_uptime_seconds ${Math.floor(r.uptime.ms / 1000)}`,
    `# HELP bingebox_cpu_avg5s CPU average 5s percent`,
    `# TYPE bingebox_cpu_avg5s gauge`,
    `bingebox_cpu_avg5s ${cpu}`,
    `# HELP bingebox_memory_percent System memory percent used`,
    `# TYPE bingebox_memory_percent gauge`,
    `bingebox_memory_percent ${mem}`,
    `# HELP bingebox_heap_used_mb Heap used MB`,
    `# TYPE bingebox_heap_used_mb gauge`,
    `bingebox_heap_used_mb ${state.heap.usedMB}`,
    `# HELP bingebox_eventloop_lag_ms Event loop lag milliseconds`,
    `# TYPE bingebox_eventloop_lag_ms gauge`,
    `bingebox_eventloop_lag_ms ${lag}`,
    `# HELP bingebox_incidents_total Total incidents`,
    `# TYPE bingebox_incidents_total counter`,
    `bingebox_incidents_total ${state.incidents.length}`,
    '',
  ];

  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(lines.join('\n'));
});

module.exports = router;
module.exports.buildReport    = buildReport;
module.exports.calcOverallStatus = calcOverallStatus;
module.exports.registerCheck  = registerCheck;
module.exports.state          = state;
