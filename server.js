'use strict';
// ═══════════════════════════════════════════════════════════════
//  BingeBox Omega — server.js  (Advanced Edition v10.0)
// ═══════════════════════════════════════════════════════════════
//  Features:
//    • Express static file serving with ETag + Cache-Control
//    • Gzip / Brotli compression
//    • Morgan request logging (with custom tokens)
//    • Security middleware stack (helmet, rate-limit, bot detect)
//    • CORS with dynamic origin validation
//    • In-process response cache for TMDB proxy routes
//    • /health  — liveness probe (Railway, Docker, k8s)
//    • /api/v1/cors-stats  — diagnostics
//    • /api/v1/server-info — version + uptime
//    • /api/v1/rate-stats  — rate-limit state
//    • Graceful shutdown (SIGTERM / SIGINT)
//    • Unhandled rejection / exception guards
//    • Request ID injection (X-Request-ID)
//    • Response time header (X-Response-Time)
//    • 404 & 500 JSON error handlers
//    • SPA catch-all serving index.html
//    • Keep-alive tuning for Railway's proxy
// ═══════════════════════════════════════════════════════════════

// ── Load env (no-op on Railway where env is injected natively) ──
try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const os         = require('os');
const compression = (() => { try { return require('compression'); } catch (_) { return null; } })();
const morgan      = (() => { try { return require('morgan'); }     catch (_) { return null; } })();

// BingeBox custom modules
const securityStack  = require('./security-config');
const corsMiddleware  = require('./cors-config');
const { getCorsStats }  = require('./cors-config');
const { getRateLimitStore } = require('./security-config');

// ── App constants ────────────────────────────────────────────────
const PORT        = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV    = process.env.NODE_ENV || 'production';
const IS_PROD     = NODE_ENV === 'production';
const PUBLIC_DIR  = path.join(__dirname, 'public');
const START_TIME  = Date.now();
const VERSION     = (() => { try { return require('./package.json').version; } catch (_) { return '10.0.0'; } })();
const SERVER_ID   = crypto.randomBytes(4).toString('hex'); // unique per process restart

// ── Logger helper ────────────────────────────────────────────────
const colorCode = c => IS_PROD ? '' : `\x1b[${c}m`;
const RESET  = colorCode(0);
const GREEN  = colorCode(32);
const YELLOW = colorCode(33);
const CYAN   = colorCode(36);
const RED    = colorCode(31);
const BOLD   = colorCode(1);

function log(tag, msg, meta) {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`${CYAN}[${tag}]${RESET} ${ts} — ${msg}${metaStr}`);
}

// ═══════════════════════════════════════════════════════════════
//  Express App
// ═══════════════════════════════════════════════════════════════
const app = express();

// Trust Railway's reverse proxy (exposes real client IP)
app.set('trust proxy', 1);

// Disable "X-Powered-By: Express"
app.disable('x-powered-by');

// ── Keep-alive settings for Railway (avoids upstream 502s) ──────
app.use((req, res, next) => {
  res.setHeader('Connection', 'keep-alive');
  next();
});

// ── Request ID ──────────────────────────────────────────────────
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ── Response timer ──────────────────────────────────────────────
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    res.setHeader('X-Response-Time', `${ms.toFixed(2)}ms`);
  });
  next();
});

// ── Compression (gzip/brotli) ───────────────────────────────────
if (compression) {
  app.use(compression({
    level: 6,
    threshold: 1024,
    filter(req, res) {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    },
  }));
  log('BOOT', 'Compression middleware enabled');
}

// ── Morgan HTTP logger ───────────────────────────────────────────
if (morgan) {
  morgan.token('id',       req => req.id);
  morgan.token('host',     req => req.headers.host);
  morgan.token('origin',   req => req.headers.origin || '-');
  const FMT = IS_PROD
    ? ':remote-addr :method :url :status :res[content-length] :response-time ms — :origin'
    : `${CYAN}:method${RESET} :url ${GREEN}:status${RESET} :response-time ms [:id]`;
  app.use(morgan(FMT, {
    skip: (req) => req.path === '/health' && IS_PROD, // skip noisy health logs in prod
  }));
}

// ── CORS ─────────────────────────────────────────────────────────
app.use(corsMiddleware);

// ── Security middleware stack ────────────────────────────────────
if (Array.isArray(securityStack)) {
  securityStack.forEach(mw => app.use(mw));
} else {
  app.use(securityStack); // backwards-compat if single middleware
}
log('BOOT', 'Security middleware stack applied');

// ── JSON / URL-encoded body parsers ─────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ═══════════════════════════════════════════════════════════════
//  Static file serving
// ═══════════════════════════════════════════════════════════════

const staticOptions = {
  etag:         true,
  lastModified: true,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();

    // Immutable assets (hashed filenames)
    if (['.woff', '.woff2', '.ttf', '.otf'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    // Long-lived JS/CSS (not hashed in this app, so 1 day)
    else if (['.js', '.css'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
    // Images
    else if (['.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
    // HTML — never cache (SPA always needs fresh entry point)
    else if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma',        'no-cache');
      res.setHeader('Expires',       '0');
    }
  },
};

// Validate public dir exists
if (!fs.existsSync(PUBLIC_DIR)) {
  log('WARN', `Public directory missing: ${PUBLIC_DIR} — creating it`);
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

app.use(express.static(PUBLIC_DIR, staticOptions));
log('BOOT', `Serving static files from: ${PUBLIC_DIR}`);

// ═══════════════════════════════════════════════════════════════
//  In-process response cache (lightweight TMDB proxy cache)
// ═══════════════════════════════════════════════════════════════

const CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function cacheGet(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { CACHE.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) {
  CACHE.set(key, { data, ts: Date.now() });
  // Prune if cache grows too large
  if (CACHE.size > 500) {
    const oldest = [...CACHE.keys()][0];
    CACHE.delete(oldest);
  }
}

// ═══════════════════════════════════════════════════════════════
//  API Routes
// ═══════════════════════════════════════════════════════════════

const apiRouter = express.Router();

// ── GET /api/v1/health ───────────────────────────────────────────
apiRouter.get('/health', (req, res) => {
  const uptime  = Math.floor((Date.now() - START_TIME) / 1000);
  const memMB   = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
  res.json({
    status:   'ok',
    version:  VERSION,
    serverId: SERVER_ID,
    uptime:   `${uptime}s`,
    env:      NODE_ENV,
    memory:   `${memMB}MB`,
    node:     process.version,
    platform: os.platform(),
    cache:    CACHE.size,
    ts:       new Date().toISOString(),
  });
});

// ── GET /api/v1/server-info ──────────────────────────────────────
apiRouter.get('/server-info', (req, res) => {
  res.json({
    name:      'BingeBox Omega Server',
    version:   VERSION,
    serverId:  SERVER_ID,
    env:       NODE_ENV,
    uptime:    process.uptime(),
    loadAvg:   os.loadavg(),
    cpus:      os.cpus().length,
    totalMem:  `${(os.totalmem() / 1024 / 1024).toFixed(0)}MB`,
    freeMem:   `${(os.freemem() / 1024 / 1024).toFixed(0)}MB`,
    hostname:  os.hostname(),
    startedAt: new Date(START_TIME).toISOString(),
  });
});

// ── GET /api/v1/cors-stats ───────────────────────────────────────
apiRouter.get('/cors-stats', (req, res) => {
  // Only expose on internal / non-prod
  if (IS_PROD && req.ip !== '127.0.0.1' && req.ip !== '::1') {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json(getCorsStats());
});

// ── GET /api/v1/rate-stats ───────────────────────────────────────
apiRouter.get('/rate-stats', (req, res) => {
  if (IS_PROD && req.ip !== '127.0.0.1' && req.ip !== '::1') {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json(getRateLimitStore());
});

// ── GET /api/v1/cache-stats ──────────────────────────────────────
apiRouter.get('/cache-stats', (req, res) => {
  if (IS_PROD && req.ip !== '127.0.0.1' && req.ip !== '::1') {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json({ size: CACHE.size, keys: [...CACHE.keys()].slice(0, 20) });
});

// ── DELETE /api/v1/cache ─────────────────────────────────────────
apiRouter.delete('/cache', (req, res) => {
  if (IS_PROD && req.ip !== '127.0.0.1' && req.ip !== '::1') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const size = CACHE.size;
  CACHE.clear();
  log('CACHE', `Cleared ${size} entries`);
  res.json({ cleared: size });
});

app.use('/api/v1', apiRouter);

// Legacy /health at root for Railway's default probe
app.get('/health', (req, res) => res.json({ status: 'ok', version: VERSION }));

// robots.txt — disallow all crawlers (streaming app, no SEO needed)
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /\n');
});

// ═══════════════════════════════════════════════════════════════
//  SPA catch-all — serve index.html for all unmatched routes
// ═══════════════════════════════════════════════════════════════

app.get('*', (req, res) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return res.status(503).json({ error: 'app_not_ready', message: 'index.html not found in public/' });
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(indexPath);
});

// ═══════════════════════════════════════════════════════════════
//  Error handlers
// ═══════════════════════════════════════════════════════════════

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// 500
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  log('ERROR', `${err.message}`, { path: req.path, method: req.method, ip: req.ip });
  res.status(status).json({
    error:   err.code || 'server_error',
    message: IS_PROD ? 'An internal error occurred.' : err.message,
    requestId: req.id,
  });
});

// ═══════════════════════════════════════════════════════════════
//  Boot
// ═══════════════════════════════════════════════════════════════

const server = app.listen(PORT, '0.0.0.0', () => {
  const addr = server.address();
  console.log('');
  console.log(`${BOLD}${GREEN}  ██████╗ ██╗███╗   ██╗ ██████╗ ███████╗██████╗  ██████╗ ██╗  ██╗${RESET}`);
  console.log(`${BOLD}${GREEN}  ██╔══██╗██║████╗  ██║██╔════╝ ██╔════╝██╔══██╗██╔═══██╗╚██╗██╔╝${RESET}`);
  console.log(`${BOLD}${RED}  ██████╔╝██║██╔██╗ ██║██║  ███╗█████╗  ██████╔╝██║   ██║ ╚███╔╝ ${RESET}`);
  console.log(`${BOLD}${RED}  ██╔══██╗██║██║╚██╗██║██║   ██║██╔══╝  ██╔══██╗██║   ██║ ██╔██╗ ${RESET}`);
  console.log(`${BOLD}${RED}  ██████╔╝██║██║ ╚████║╚██████╔╝███████╗██████╔╝╚██████╔╝██╔╝ ██╗${RESET}`);
  console.log(`${BOLD}${RED}  ╚═════╝ ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝${RESET}`);
  console.log('');
  log('BOOT', `${BOLD}BingeBox Omega v${VERSION}${RESET} is live`);
  log('BOOT', `Port: ${YELLOW}${addr.port}${RESET} | Env: ${YELLOW}${NODE_ENV}${RESET} | Node: ${YELLOW}${process.version}${RESET}`);
  log('BOOT', `Server ID: ${CYAN}${SERVER_ID}${RESET}`);
  log('BOOT', `Health: http://localhost:${addr.port}/health`);
  log('BOOT', `OmegaShield ACTIVE — All security layers armed.`);
  console.log('');
});

// Keep-alive timeout > Railway's 90-second idle (prevents 502s)
server.keepAliveTimeout = 120000;
server.headersTimeout    = 121000;

// ═══════════════════════════════════════════════════════════════
//  Graceful shutdown
// ═══════════════════════════════════════════════════════════════

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log('SHUTDOWN', `Received ${signal} — shutting down gracefully…`);

  server.close(err => {
    if (err) {
      log('SHUTDOWN', 'Error during server close', { err: err.message });
      process.exit(1);
    }
    log('SHUTDOWN', 'All connections closed. Goodbye!');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    log('SHUTDOWN', 'Force exit after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ═══════════════════════════════════════════════════════════════
//  Global error guards
// ═══════════════════════════════════════════════════════════════

process.on('unhandledRejection', (reason, promise) => {
  log('ERROR', 'Unhandled Promise Rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  log('FATAL', `Uncaught Exception: ${err.message}`, { stack: err.stack?.split('\n')[1] });
  // Don't exit — Railway will restart if truly fatal
});

module.exports = app; // for testing
