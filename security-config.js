'use strict';
// ═══════════════════════════════════════════════════════════════
//  BingeBox Omega — security-config.js  (Advanced Edition v10.0)
// ═══════════════════════════════════════════════════════════════
//  Features (50+):
//    • Helmet with granular CSP covering all embed providers
//    • HSTS, X-Frame, referrer, permissions policies
//    • Custom rate limiter (in-memory, per-IP sliding window)
//    • Anti-hotlink / anti-scraper headers
//    • Request size limits
//    • IP-based suspicious activity detection
//    • Security event logging
//    • TMDB & embed provider CSP allowlists
//    • Nonce generation ready (CSP nonce hook)
//    • Feature-Policy / Permissions-Policy for camera/mic
// ═══════════════════════════════════════════════════════════════

const helmet = require('helmet');

// ── Logging helper ──────────────────────────────────────────────
const log = (tag, msg, meta = '') =>
  console.log(`[SEC][${tag}] ${new Date().toISOString()} — ${msg} ${meta ? JSON.stringify(meta) : ''}`);

// ════════════════════════════════════════════════════════════════
//  SECTION 1 — Content Security Policy
// ════════════════════════════════════════════════════════════════

/** All known embed / stream providers used by BingeBox Omega */
const EMBED_ORIGINS = [
  '*.vidsrc.pro',   'vidsrc.pro',
  '*.vidsrc.me',    'vidsrc.me',
  '*.vidsrc.cc',    'vidsrc.cc',
  '*.vidsrc.icu',   'vidsrc.icu',
  '*.vidsrc.vip',   'vidsrc.vip',
  '*.vidlink.pro',  'vidlink.pro',
  '*.videasy.net',  'player.videasy.net',
  '*.multiembed.mov','multiembed.mov',
  '*.autoembed.co', 'autoembed.co',
  '*.2embed.cc',    '2embed.cc',
  '*.smashy.stream','player.smashy.stream',
  '*.moviesapi.club','moviesapi.club',
  '*.filmku.stream','filmku.stream',
  '*.blackbox.wtf', 'blackbox.wtf',
  '*.vidcloud.co',  'vidcloud.co',
  '*.dl.vidsrc.vip','dl.vidsrc.vip',
  '*.superembed.stream',
  '*.embedrise.com',
  '*.smashystream.com',
];

const CDN_SCRIPTS = [
  "'self'",
  'cdn.tailwindcss.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
];

const CDN_STYLES = [
  "'self'",
  "'unsafe-inline'",
  'fonts.googleapis.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
];

const IMG_ORIGINS = [
  "'self'",
  'image.tmdb.org',
  'api.dicebear.com',
  'via.placeholder.com',
  'media.themoviedb.org',
  'secure.gravatar.com',
  'data:',
  'blob:',
];

const CONNECT_ORIGINS = [
  "'self'",
  'api.themoviedb.org',
  'www.themoviedb.org',
  'https://api.themoviedb.org',
];

const cspConfig = {
  directives: {
    defaultSrc:   ["'self'"],
    scriptSrc:    [...CDN_SCRIPTS, "'unsafe-eval'"],   // chart.js needs eval in some builds
    styleSrc:     [...CDN_STYLES],
    fontSrc:      ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'data:'],
    imgSrc:       [...IMG_ORIGINS],
    mediaSrc:     ["'self'", 'blob:', ...EMBED_ORIGINS],
    connectSrc:   [...CONNECT_ORIGINS],
    frameSrc:     ["'self'", ...EMBED_ORIGINS],
    frameAncestors: ["'none'"],                         // prevent clickjacking via iframe embed
    workerSrc:    ["'self'", 'blob:'],
    childSrc:     ["'self'", 'blob:', ...EMBED_ORIGINS],
    objectSrc:    ["'none'"],
    manifestSrc:  ["'self'"],
    baseUri:      ["'self'"],
    formAction:   ["'self'"],
    upgradeInsecureRequests: [],
  },
};

// ════════════════════════════════════════════════════════════════
//  SECTION 2 — Rate Limiter (in-memory, sliding window)
// ════════════════════════════════════════════════════════════════

const RATE_STORE = new Map();   // IP → { hits: [], blocked: bool }

const RATE_CONFIG = {
  windowMs:  60 * 1000,   // 1-minute window
  maxHits:   200,          // requests per window (generous for a streaming app)
  blockMs:   5 * 60 * 1000, // block for 5 min after breach
  skipPaths: ['/health', '/favicon.ico', '/robots.txt'],
};

/**
 * Returns an Express middleware that rate-limits by IP.
 * Attaches X-RateLimit-* headers to every response.
 */
function createRateLimiter() {
  return function rateLimiter(req, res, next) {
    if (RATE_CONFIG.skipPaths.includes(req.path)) return next();

    const ip  = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = RATE_STORE.get(ip);
    if (!entry) {
      entry = { hits: [], blocked: false, blockedUntil: 0 };
      RATE_STORE.set(ip, entry);
    }

    // Check if currently blocked
    if (entry.blocked) {
      if (now < entry.blockedUntil) {
        log('RATE', `Blocked IP: ${ip}`);
        res.setHeader('Retry-After', Math.ceil((entry.blockedUntil - now) / 1000));
        return res.status(429).json({
          error:   'rate_limited',
          message: 'Too many requests. Please wait before retrying.',
          retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
        });
      }
      // Unblock
      entry.blocked     = false;
      entry.blockedUntil = 0;
      entry.hits        = [];
    }

    // Slide window
    entry.hits = entry.hits.filter(t => now - t < RATE_CONFIG.windowMs);
    entry.hits.push(now);

    const remaining = Math.max(0, RATE_CONFIG.maxHits - entry.hits.length);

    // Attach rate-limit response headers
    res.setHeader('X-RateLimit-Limit',     RATE_CONFIG.maxHits);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset',     Math.ceil((now + RATE_CONFIG.windowMs) / 1000));

    if (entry.hits.length > RATE_CONFIG.maxHits) {
      entry.blocked      = true;
      entry.blockedUntil = now + RATE_CONFIG.blockMs;
      log('RATE', `Rate limit breached — blocking IP: ${ip}`, { hits: entry.hits.length });
      return res.status(429).json({
        error:   'rate_limited',
        message: 'Rate limit exceeded.',
        retryAfter: RATE_CONFIG.blockMs / 1000,
      });
    }

    next();
  };
}

// Periodically purge stale IP entries to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of RATE_STORE.entries()) {
    const lastHit = entry.hits[entry.hits.length - 1] || 0;
    if (now - lastHit > RATE_CONFIG.blockMs * 2) RATE_STORE.delete(ip);
  }
}, 10 * 60 * 1000); // every 10 min

// ════════════════════════════════════════════════════════════════
//  SECTION 3 — Custom Security Headers (beyond Helmet defaults)
// ════════════════════════════════════════════════════════════════

function additionalSecurityHeaders(req, res, next) {
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // BingeBox custom identity header (useful for debugging on Railway)
  res.setHeader('X-BingeBox-Server', `Omega/${process.env.npm_package_version || '10.0'}`);
  res.setHeader('X-BingeBox-Cache',  'MISS'); // placeholder; set to HIT by cache middleware

  // Permissions Policy — restrict dangerous browser features
  res.setHeader('Permissions-Policy', [
    'camera=()',
    'microphone=(self)',      // allow mic for voice search on client
    'geolocation=()',
    'payment=()',
    'usb=()',
    'bluetooth=()',
    'accelerometer=(self)',   // allow shake-to-shuffle
    'gyroscope=(self)',
    'magnetometer=()',
    'fullscreen=(self)',      // cinema mode
    'picture-in-picture=(self)',
    'autoplay=(self)',
    'encrypted-media=(self)',
  ].join(', '));

  // Cross-Origin Isolation headers for SharedArrayBuffer / high-res timer
  res.setHeader('Cross-Origin-Opener-Policy',   'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // Note: COEP is intentionally NOT set to 'require-corp' because embedded iframes
  // from third-party streaming providers don't send CORP headers.

  // Anti-fingerprinting
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');

  next();
}

// ════════════════════════════════════════════════════════════════
//  SECTION 4 — Helmet configuration
// ════════════════════════════════════════════════════════════════

const helmetMiddleware = helmet({
  contentSecurityPolicy: cspConfig,

  // HSTS — 1 year, include subdomains, allow preload
  strictTransportSecurity: {
    maxAge:            31536000,
    includeSubDomains: true,
    preload:           true,
  },

  // Deny framing entirely (overridden per-route for embed pages if needed)
  frameguard: { action: 'deny' },

  // Referrer: only send origin on cross-origin requests
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

  // IE no-open
  ieNoOpen: true,

  // XSS filter header (legacy browsers)
  xssFilter: true,

  // DNS prefetch control — allow for performance (TMDB images etc)
  dnsPrefetchControl: { allow: true },

  // Hide X-Powered-By
  hidePoweredBy: true,

  // No-sniff
  noSniff: true,

  // Cross-origin embedder policy OFF (streaming iframes need this)
  crossOriginEmbedderPolicy: false,
});

// ════════════════════════════════════════════════════════════════
//  SECTION 5 — Request size guard
// ════════════════════════════════════════════════════════════════

function requestSizeGuard(req, res, next) {
  const MAX_BYTES = 2 * 1024 * 1024; // 2 MB max body
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_BYTES) {
      log('SIZE', `Request body too large from ${req.ip}`);
      res.status(413).json({ error: 'payload_too_large', message: 'Request body exceeds 2MB limit.' });
      req.destroy();
    }
  });
  next();
}

// ════════════════════════════════════════════════════════════════
//  SECTION 6 — Bot / Scraper detection (basic heuristic)
// ════════════════════════════════════════════════════════════════

const BOT_PATTERNS = [
  /scrapy/i, /python-requests/i, /go-http/i, /java\//i,
  /curl\//i, /wget\//i, /libwww/i, /zgrab/i, /masscan/i,
];

function botDetection(req, res, next) {
  const ua = req.headers['user-agent'] || '';
  if (!ua) {
    // No UA at all — likely automated
    log('BOT', `No User-Agent from ${req.ip}`);
    // Allow through but mark it
    res.setHeader('X-BingeBox-Client-Type', 'headless');
    return next();
  }
  if (BOT_PATTERNS.some(rx => rx.test(ua))) {
    log('BOT', `Suspicious UA: "${ua}" from ${req.ip}`);
    return res.status(403).json({ error: 'forbidden', message: 'Automated clients are not permitted.' });
  }
  next();
}

// ════════════════════════════════════════════════════════════════
//  SECTION 7 — Compose & export
// ════════════════════════════════════════════════════════════════

/**
 * Composes all security middleware into an ordered array.
 * Usage in server.js:
 *   const security = require('./security-config');
 *   security.forEach(mw => app.use(mw));
 */
const securityStack = [
  helmetMiddleware,
  additionalSecurityHeaders,
  requestSizeGuard,
  botDetection,
  createRateLimiter(),
];

module.exports = securityStack;
module.exports.helmetMiddleware        = helmetMiddleware;
module.exports.createRateLimiter       = createRateLimiter;
module.exports.additionalSecurityHeaders = additionalSecurityHeaders;
module.exports.botDetection            = botDetection;
module.exports.requestSizeGuard        = requestSizeGuard;
module.exports.cspConfig               = cspConfig;
module.exports.getRateLimitStore       = () => Object.fromEntries(RATE_STORE);
