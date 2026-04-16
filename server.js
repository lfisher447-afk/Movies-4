'use strict';
// ═══════════════════════════════════════════════════════════════
//  BingeBox Omega — server.js  (Advanced Edition v10.0)
// ═══════════════════════════════════════════════════════════════

try { require('dotenv').config(); } catch (_) {}

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const os         = require('os');
const compression = (() => { try { return require('compression'); } catch (_) { return null; } })();

// BingeBox custom modules
const logger         = require('./logger');
const appLogger      = logger.root;
const securityStack  = require('./security-config');
const corsMiddleware = require('./cors-config');
const { getCorsStats } = require('./cors-config');
const { getRateLimitStore } = require('./security-config');
const cacheManager   = require('./cache-manager');
const apiProxy       = require('./api-proxy');
const healthMonitor  = require('./health-monitor');

// ── App constants ────────────────────────────────────────────────
const PORT        = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV    = process.env.NODE_ENV || 'production';
const IS_PROD     = NODE_ENV === 'production';
const PUBLIC_DIR  = path.join(__dirname, 'public');
const START_TIME  = Date.now();
const VERSION     = (() => { try { return require('./package.json').version; } catch (_) { return '10.0.0'; } })();
const SERVER_ID   = crypto.randomBytes(4).toString('hex'); 

// ═══════════════════════════════════════════════════════════════
//  Express App
// ═══════════════════════════════════════════════════════════════
const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('Connection', 'keep-alive');
  next();
});

app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ── Response timer fix ──────────────────────────────────────────
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();

  // Primary method: intercept writeHead to guarantee header before sent
  const _writeHead = res.writeHead;
  res.writeHead = function(...args) {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    this.setHeader('X-Response-Time', `${ms.toFixed(2)}ms`);
    return _writeHead.apply(this, args);
  };

  // Fallback prefinish event hook
  res.on('prefinish', () => {
    if (!res.headersSent) {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      res.setHeader('X-Response-Time', `${ms.toFixed(2)}ms`);
    }
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
      // Guard: Ensure static compression.filter exists
      if (compression.filter) return compression.filter(req, res);
      return true;
    },
  }));
  appLogger.info('Compression middleware enabled');
}

// ── HTTP logger replacing morgan ─────────────────────────────────
app.use(logger.requestLogger());

app.use(corsMiddleware);

if (Array.isArray(securityStack)) {
  securityStack.forEach(mw => app.use(mw));
} else {
  app.use(securityStack);
}
appLogger.info('Security middleware stack applied');

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
    if (['.woff', '.woff2', '.ttf', '.otf'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (['.js', '.css'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else if (['.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    } else if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma',        'no-cache');
      res.setHeader('Expires',       '0');
    }
  },
};

if (!fs.existsSync(PUBLIC_DIR)) {
  appLogger.warn(`Public directory missing: ${PUBLIC_DIR} — creating it`);
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

app.use(express.static(PUBLIC_DIR, staticOptions));
appLogger.info(`Serving static files from: ${PUBLIC_DIR}`);

// ═══════════════════════════════════════════════════════════════
//  API Routes
// ═══════════════════════════════════════════════════════════════

// Mount health checks
app.use('/health', healthMonitor);

const apiRouter = express.Router();

// Mount Cache Manager endpoints
apiRouter.use('/cache', cacheManager.router);

// Mount TMDB Proxy endpoints
apiRouter.use(apiProxy);

// Internal Endpoints
apiRouter.get('/logs', logger.logsHandler);

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

apiRouter.get('/cors-stats', (req, res) => {
  if (IS_PROD && req.ip !== '127.0.0.1' && req.ip !== '::1') return res.status(403).json({ error: 'forbidden' });
  res.json(getCorsStats());
});

apiRouter.get('/rate-stats', (req, res) => {
  if (IS_PROD && req.ip !== '127.0.0.1' && req.ip !== '::1') return res.status(403).json({ error: 'forbidden' });
  res.json(getRateLimitStore());
});

app.use('/api/v1', apiRouter);

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /\n');
});

// ═══════════════════════════════════════════════════════════════
//  SPA catch-all
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

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  appLogger.error(`${err.message}`, { path: req.path, method: req.method, ip: req.ip });
  res.status(status).json({
    error:   err.code || 'server_error',
    message: IS_PROD ? 'An internal error occurred.' : err.message,
    requestId: req.id,
  });
});

// ═══════════════════════════════════════════════════════════════
//  Boot & Shutdown
// ═══════════════════════════════════════════════════════════════

const server = app.listen(PORT, '0.0.0.0', () => {
  const addr = server.address();
  appLogger.info(`BingeBox Omega v${VERSION} is live`);
  appLogger.info(`Port: ${addr.port} | Env: ${NODE_ENV} | Node: ${process.version}`);
  appLogger.info(`Server ID: ${SERVER_ID}`);
  appLogger.info(`Health: http://localhost:${addr.port}/health`);
  appLogger.info(`OmegaShield ACTIVE — All security layers armed.`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout   = 121000;

let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  appLogger.info(`Received ${signal} — shutting down gracefully…`);
  server.close(err => {
    if (err) { appLogger.error('Error during server close', { err: err.message }); process.exit(1); }
    appLogger.info('All connections closed. Goodbye!');
    process.exit(0);
  });
  setTimeout(() => { appLogger.info('Force exit after timeout'); process.exit(1); }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => appLogger.error('Unhandled Promise Rejection', { reason: String(reason) }));
process.on('uncaughtException', (err) => appLogger.fatal(`Uncaught Exception: ${err.message}`, { stack: err.stack?.split('\n')[1] }));

module.exports = app;
