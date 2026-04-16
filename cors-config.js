'use strict';
// ═══════════════════════════════════════════════════════════════
//  BingeBox Omega — cors-config.js  (Advanced Edition v10.0)
// ═══════════════════════════════════════════════════════════════

const cors = require('cors');

const log = (tag, msg, meta = '') =>
  console.log(`[CORS][${tag}] ${msg} ${meta ? JSON.stringify(meta) : ''}`);

const IS_DEV = process.env.NODE_ENV !== 'production';

const STATIC_ORIGINS =[
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
];

function buildAllowedOrigins() {
  const dynamic =[];
  if (process.env.CLIENT_URL) {
    const raw = process.env.CLIENT_URL.split(',').map(s => s.trim()).filter(Boolean);
    dynamic.push(...raw);
  }
  if (process.env.STAGING_URL)  dynamic.push(process.env.STAGING_URL.trim());
  if (process.env.PREVIEW_URL)  dynamic.push(process.env.PREVIEW_URL.trim());
  return [...new Set([...STATIC_ORIGINS, ...dynamic])];
}

const TRUSTED_PATTERNS = [
  /^https:\/\/([\w-]+\.)?bingebox\.tv$/,
  /^https:\/\/([\w-]+\.)?bingebox\.app$/,
  /^https:\/\/[\w-]+-bingebox\.vercel\.app$/,
  /^https:\/\/[\w-]+-bingebox\.netlify\.app$/,
  /^https:\/\/[\w-]+\.railway\.app$/,
];

const rejectionTracker = new Map();
const MAX_REJECT_LOG   = 100;

function trackRejection(origin) {
  if (rejectionTracker.size >= MAX_REJECT_LOG) return;
  const entry = rejectionTracker.get(origin) || { count: 0, firstSeen: Date.now() };
  entry.count++;
  rejectionTracker.set(origin, entry);
}

function isOriginAllowed(origin) {
  if (!origin) return true;                            
  const allowed = buildAllowedOrigins();
  if (allowed.includes(origin)) return true;           
  if (TRUSTED_PATTERNS.some(rx => rx.test(origin))) return true; 
  return false;
}

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      if (IS_DEV) log('ALLOW', origin || '<same-origin>'); // No longer logs probes in production
      callback(null, true);
    } else {
      trackRejection(origin);
      log('BLOCK', origin, { totalRejections: rejectionTracker.get(origin)?.count });
      callback(new Error(`CORS: Origin "${origin}" is not permitted.`));
    }
  },
  methods:['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders:[
    'Content-Type', 'Authorization', 'X-Requested-With', 'Accept',
    'Accept-Language', 'Cache-Control', 'X-BingeBox-Client', 'X-BingeBox-Version',
  ],
  exposedHeaders:[
    'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset',
    'X-BingeBox-Cache', 'X-BingeBox-Server', 'Content-Length', 'Content-Range', 'ETag',
  ],
  credentials: true,
  maxAge: 7200,
  optionsSuccessStatus: 204,
  preflightContinue: false,
};

const corsMiddleware = cors(corsOptions);

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
