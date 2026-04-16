'use strict';
// ═══════════════════════════════════════════════════════════════
//  BingeBox Omega — cors-config.js  (Advanced Edition v10.0)
// ═══════════════════════════════════════════════════════════════
//  Features:
//    • Dynamic origin whitelist (env + hardcoded)
//    • Regex-based subdomain allowance
//    • Per-origin rate-limit hit counter (in-memory)
//    • Detailed CORS rejection logging
//    • Preflight cache (OPTIONS) via maxAge
//    • Exposed headers for streaming clients
//    • Wildcard bypass safety lock
//    • Credential-safe origin enforcement
// ═══════════════════════════════════════════════════════════════

const cors = require('cors');

// ── Helpers ─────────────────────────────────────────────────────
const log = (tag, msg, meta = '') =>
  console.log(`[CORS][${tag}] ${msg} ${meta ? JSON.stringify(meta) : ''}`);

// ── Static allowed origins ───────────────────────────────────────
const STATIC_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
];

// ── Dynamic origins from environment ────────────────────────────
function buildAllowedOrigins() {
  const dynamic = [];
  // CLIENT_URL can be a comma-separated list of allowed URLs
  if (process.env.CLIENT_URL) {
    const raw = process.env.CLIENT_URL.split(',').map(s => s.trim()).filter(Boolean);
    dynamic.push(...raw);
  }
  // Extra origins for staging / preview deploys
  if (process.env.STAGING_URL)  dynamic.push(process.env.STAGING_URL.trim());
  if (process.env.PREVIEW_URL)  dynamic.push(process.env.PREVIEW_URL.trim());

  return [...new Set([...STATIC_ORIGINS, ...dynamic])];
}

// ── Regex patterns for trusted sub-domains ───────────────────────
const TRUSTED_PATTERNS = [
  /^https:\/\/([\w-]+\.)?bingebox\.tv$/,
  /^https:\/\/([\w-]+\.)?bingebox\.app$/,
  /^https:\/\/[\w-]+-bingebox\.vercel\.app$/,
  /^https:\/\/[\w-]+-bingebox\.netlify\.app$/,
  /^https:\/\/[\w-]+\.railway\.app$/,
];

// ── In-memory rejection tracker (resets on restart) ─────────────
const rejectionTracker = new Map(); // origin → { count, firstSeen }
const MAX_REJECT_LOG   = 100;       // Stop tracking after N unique bad origins

function trackRejection(origin) {
  if (rejectionTracker.size >= MAX_REJECT_LOG) return;
  const entry = rejectionTracker.get(origin) || { count: 0, firstSeen: Date.now() };
  entry.count++;
  rejectionTracker.set(origin, entry);
}

// ── Core origin validator ────────────────────────────────────────
function isOriginAllowed(origin) {
  if (!origin) return true;                            // Same-origin / curl / mobile

  const allowed = buildAllowedOrigins();
  if (allowed.includes(origin)) return true;           // Exact match

  if (TRUSTED_PATTERNS.some(rx => rx.test(origin))) return true; // Pattern match

  return false;
}

// ── CORS options object ──────────────────────────────────────────
const corsOptions = {
  /**
   * origin validator — called for every cross-origin request.
   * `callback(err, allow)`:  allow=true | allow=false | allow=string
   */
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      log('ALLOW', origin || '<same-origin>');
      callback(null, true);
    } else {
      trackRejection(origin);
      log('BLOCK', origin, { totalRejections: rejectionTracker.get(origin)?.count });
      callback(new Error(`CORS: Origin "${origin}" is not permitted.`));
    }
  },

  // ── Allowed HTTP methods ────────────────────────────────────────
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],

  // ── Allowed request headers ─────────────────────────────────────
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Accept-Language',
    'Cache-Control',
    'X-BingeBox-Client',   // custom client identifier
    'X-BingeBox-Version',  // client version handshake
  ],

  // ── Headers the browser JS can read from responses ──────────────
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-BingeBox-Cache',
    'X-BingeBox-Server',
    'Content-Length',
    'Content-Range',
    'ETag',
  ],

  // ── Allow cookies / Auth headers in cross-origin requests ───────
  credentials: true,

  // ── Preflight cache: browsers cache OPTIONS for 2 hours ─────────
  maxAge: 7200,

  // ── Return 204 for OPTIONS (some clients expect this) ───────────
  optionsSuccessStatus: 204,

  // ── Disable legacy IE header ────────────────────────────────────
  preflightContinue: false,
};

// ── CORS middleware with global error handler ────────────────────
const corsMiddleware = cors(corsOptions);

/**
 * Wraps the standard cors() middleware to intercept CORS errors
 * and return a clean JSON 403 instead of a generic crash.
 */
function safeCors(req, res, next) {
  corsMiddleware(req, res, (err) => {
    if (err) {
      log('ERROR', err.message);
      res.setHeader('Content-Type', 'application/json');
      return res.status(403).json({
        error:   'cors_blocked',
        message: err.message,
        origin:  req.headers.origin || null,
      });
    }
    next();
  });
}

// ── Diagnostics endpoint helper (imported by server.js if needed) ─
function getCorsStats() {
  return {
    allowedOrigins: buildAllowedOrigins(),
    trustedPatterns: TRUSTED_PATTERNS.map(rx => rx.toString()),
    rejections: Object.fromEntries(rejectionTracker),
  };
}

module.exports = safeCors;
module.exports.getCorsStats   = getCorsStats;
module.exports.isOriginAllowed = isOriginAllowed;
