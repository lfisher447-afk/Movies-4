'use strict';
// ═══════════════════════════════════════════════════════════════
//  BingeBox Omega — logger.js  (NEW — Advanced v10.0)
// ═══════════════════════════════════════════════════════════════
//  Features:
//    • Five log levels: DEBUG, INFO, WARN, ERROR, FATAL
//    • ANSI colour output in development
//    • Structured JSON output in production (Railway-compatible)
//    • Request/response logging middleware (replaces morgan dep)
//    • Async file logging with daily rotation (no deps)
//    • Log buffer (holds last N entries for /api/v1/logs endpoint)
//    • Redaction of sensitive fields (api_key, Authorization)
//    • Performance marks integration (measure() helper)
//    • Child logger factory (per-module context)
//    • Global process error capture
// ═══════════════════════════════════════════════════════════════

const fs    = require('fs');
const path  = require('path');
const os    = require('os');

// ── Config ───────────────────────────────────────────────────────
const IS_PROD    = (process.env.NODE_ENV || 'production') === 'production';
const LOG_DIR    = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const LOG_LEVEL  = (process.env.LOG_LEVEL || (IS_PROD ? 'INFO' : 'DEBUG')).toUpperCase();
const BUFFER_MAX = 200;  // max entries kept in memory ring-buffer

// ── Levels ───────────────────────────────────────────────────────
const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };

// ── ANSI colours ────────────────────────────────────────────────
const C = IS_PROD ? {} : {
  RESET:  '\x1b[0m',
  BOLD:   '\x1b[1m',
  DIM:    '\x1b[2m',
  DEBUG:  '\x1b[36m',   // cyan
  INFO:   '\x1b[32m',   // green
  WARN:   '\x1b[33m',   // yellow
  ERROR:  '\x1b[31m',   // red
  FATAL:  '\x1b[35m',   // magenta
};
const cc = key => C[key] || '';

// ── Ring buffer ──────────────────────────────────────────────────
const logBuffer = [];
function pushBuffer(entry) {
  logBuffer.push(entry);
  if (logBuffer.length > BUFFER_MAX) logBuffer.shift();
}

// ── Sensitive key redaction ──────────────────────────────────────
const REDACT_KEYS = new Set(['api_key', 'apikey', 'authorization', 'password', 'token', 'secret', 'cookie']);
function redact(obj, depth = 0) {
  if (depth > 4 || typeof obj !== 'object' || obj === null) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

// ── File writer ──────────────────────────────────────────────────
let fileStream   = null;
let currentDate  = '';

function getLogStream() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== currentDate || !fileStream) {
    if (fileStream) fileStream.end();
    currentDate = today;
    try {
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      const filePath = path.join(LOG_DIR, `bingebox-${today}.log`);
      fileStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
    } catch (_) {
      fileStream = null; // File logging disabled gracefully
    }
  }
  return fileStream;
}

// Rotate/prune logs older than 14 days
function pruneOldLogs() {
  try {
    if (!fs.existsSync(LOG_DIR)) return;
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOG_DIR)) {
      const fp = path.join(LOG_DIR, f);
      if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
    }
  } catch (_) {}
}
setInterval(pruneOldLogs, 6 * 60 * 60 * 1000); // every 6 hours
pruneOldLogs();

// ── Core write function ──────────────────────────────────────────
function write(level, context, message, meta) {
  if (LEVELS[level] < LEVELS[LOG_LEVEL]) return;

  const ts      = new Date().toISOString();
  const pid     = process.pid;
  const host    = os.hostname();
  const cleaned = meta ? redact(meta) : undefined;

  const entry = {
    level,
    ts,
    context,
    message,
    pid,
    host,
    ...(cleaned ? { meta: cleaned } : {}),
  };

  pushBuffer(entry);

  if (IS_PROD) {
    // Structured JSON — Railway log aggregation picks this up
    const line = JSON.stringify(entry) + '\n';
    process.stdout.write(line);
    const stream = getLogStream();
    if (stream) stream.write(line);
  } else {
    // Human-readable coloured output
    const col   = cc(level);
    const reset = cc('RESET');
    const dim   = cc('DIM');
    const bold  = cc('BOLD');
    const tag   = `${col}${bold}[${level.padEnd(5)}]${reset}`;
    const ctx   = context ? `${dim}[${context}]${reset}` : '';
    const metaStr = cleaned ? `\n  ${dim}${JSON.stringify(cleaned, null, 2).replace(/\n/g, '\n  ')}${reset}` : '';
    const line  = `${dim}${ts}${reset} ${tag} ${ctx} ${message}${metaStr}\n`;
    process.stdout.write(line);
    const stream = getLogStream();
    if (stream) stream.write(JSON.stringify(entry) + '\n');
  }
}

// ═══════════════════════════════════════════════════════════════
//  Logger factory
// ═══════════════════════════════════════════════════════════════

function createLogger(context = 'APP') {
  return {
    debug(msg, meta)  { write('DEBUG', context, msg, meta); },
    info(msg, meta)   { write('INFO',  context, msg, meta); },
    warn(msg, meta)   { write('WARN',  context, msg, meta); },
    error(msg, meta)  { write('ERROR', context, msg, meta); },
    fatal(msg, meta)  { write('FATAL', context, msg, meta); },

    /** Timer helper: returns a done() function that logs elapsed time */
    time(label) {
      const t0 = process.hrtime.bigint();
      return (extra = {}) => {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        write('DEBUG', context, `${label} — ${ms.toFixed(2)}ms`, extra);
        return ms;
      };
    },

    /** Create child logger with nested context */
    child(subContext) {
      return createLogger(`${context}:${subContext}`);
    },
  };
}

// ── Root logger ──────────────────────────────────────────────────
const rootLogger = createLogger('BingeBox');

// ═══════════════════════════════════════════════════════════════
//  Express request logger middleware
// ═══════════════════════════════════════════════════════════════

function requestLogger(options = {}) {
  const skip    = options.skip || ((req) => req.path === '/health');
  const reqLog  = createLogger('HTTP');

  return function logRequest(req, res, next) {
    if (skip(req)) return next();

    const t0  = process.hrtime.bigint();
    const id  = req.id || req.headers['x-request-id'] || '-';

    // Log incoming request
    reqLog.debug(`→ ${req.method} ${req.path}`, {
      id,
      query:  Object.keys(req.query).length ? req.query : undefined,
      ip:     req.ip,
      ua:     req.headers['user-agent']?.slice(0, 80),
    });

    // Intercept finish
    res.on('finish', () => {
      const ms     = Number(process.hrtime.bigint() - t0) / 1e6;
      const level  = res.statusCode >= 500 ? 'ERROR'
                   : res.statusCode >= 400 ? 'WARN'
                   : 'INFO';
      write(level, 'HTTP', `${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(0)}ms`, {
        id,
        status: res.statusCode,
        ms:     parseFloat(ms.toFixed(2)),
        bytes:  parseInt(res.getHeader('content-length') || '0', 10) || undefined,
        ip:     req.ip,
      });
    });

    next();
  };
}

// ═══════════════════════════════════════════════════════════════
//  /api/v1/logs endpoint handler
// ═══════════════════════════════════════════════════════════════

function logsHandler(req, res) {
  const IS_PROD_REQ = (process.env.NODE_ENV || 'production') === 'production';
  if (IS_PROD_REQ && req.ip !== '127.0.0.1' && req.ip !== '::1') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const level  = (req.query.level || '').toUpperCase();
  const limit  = Math.min(parseInt(req.query.limit || '50', 10), BUFFER_MAX);
  const filtered = level && LEVELS[level] != null
    ? logBuffer.filter(e => LEVELS[e.level] >= LEVELS[level])
    : logBuffer;
  res.json({ total: logBuffer.length, returned: Math.min(limit, filtered.length), entries: filtered.slice(-limit) });
}

// ═══════════════════════════════════════════════════════════════
//  Global error capture
// ═══════════════════════════════════════════════════════════════

process.on('unhandledRejection', (reason) => {
  rootLogger.error('Unhandled Promise Rejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  rootLogger.fatal('Uncaught Exception', { message: err.message, stack: err.stack?.split('\n').slice(0, 3).join(' ← ') });
});

// ═══════════════════════════════════════════════════════════════
//  Exports
// ═══════════════════════════════════════════════════════════════

module.exports = createLogger;
module.exports.root           = rootLogger;
module.exports.requestLogger  = requestLogger;
module.exports.logsHandler    = logsHandler;
module.exports.getBuffer      = () => [...logBuffer];
module.exports.createLogger   = createLogger;
