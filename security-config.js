'use strict';
// ═══════════════════════════════════════════════════════════════
//  BingeBox Omega — security-config.js  (Advanced Edition v10.1)
// ═══════════════════════════════════════════════════════════════

const helmet = require('helmet');

const log = (tag, msg, meta = '') =>
  console.log(`[SEC][${tag}] ${new Date().toISOString()} — ${msg} ${meta ? JSON.stringify(meta) : ''}`);

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
    scriptSrc:    [...CDN_SCRIPTS, "'unsafe-eval'"],
    styleSrc:     [...CDN_STYLES],
    fontSrc:      ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'data:'],
    imgSrc:       [...IMG_ORIGINS],
    mediaSrc:     ["'self'", 'blob:', ...EMBED_ORIGINS],
    connectSrc:   [...CONNECT_ORIGINS],
    frameSrc:     ["'self'", ...EMBED_ORIGINS],
    frameAncestors: ["'none'"],                         
    workerSrc:    ["'self'", 'blob:'],
    childSrc:     ["'self'", 'blob:', ...EMBED_ORIGINS],
    objectSrc:    ["'none'"],
    manifestSrc:  ["'self'"],
    baseUri:      ["'self'"],
    formAction:   ["'self'"],
    upgradeInsecureRequests: [],
  },
};

const RATE_STORE = new Map();

const RATE_CONFIG = {
  windowMs:  60 * 1000,
  maxHits:   200,          
  blockMs:   5 * 60 * 1000, 
  skipPaths: ['/health', '/favicon.ico', '/robots.txt'],
};

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

    if (entry.blocked) {
      if (now < entry.blockedUntil) {
        res.setHeader('Retry-After', Math.ceil((entry.blockedUntil - now) / 1000));
        return res.status(429).json({
          error:   'rate_limited',
          message: 'Too many requests. Please wait before retrying.',
          retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
        });
      }
      entry.blocked     = false;
      entry.blockedUntil = 0;
      entry.hits        = [];
    }

    entry.hits = entry.hits.filter(t => now - t < RATE_CONFIG.windowMs);
    entry.hits.push(now);

    const remaining = Math.max(0, RATE_CONFIG.maxHits - entry.hits.length);

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

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of RATE_STORE.entries()) {
    const lastHit = entry.hits[entry.hits.length - 1] || 0;
    if (now - lastHit > RATE_CONFIG.blockMs * 2) RATE_STORE.delete(ip);
  }
}, 10 * 60 * 1000);

function additionalSecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-BingeBox-Server', `Omega/${process.env.npm_package_version || '10.0'}`);
  res.setHeader('X-BingeBox-Cache',  'MISS');

  res.setHeader('Permissions-Policy', [
    'camera=()', 'microphone=(self)', 'geolocation=()', 'payment=()', 'usb=()',
    'bluetooth=()', 'accelerometer=(self)', 'gyroscope=(self)', 'magnetometer=()',
    'fullscreen=(self)', 'picture-in-picture=(self)', 'autoplay=(self)', 'encrypted-media=(self)',
  ].join(', '));

  res.setHeader('Cross-Origin-Opener-Policy',   'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');

  next();
}

const helmetMiddleware = helmet({
  contentSecurityPolicy: cspConfig,
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  ieNoOpen: true,
  xssFilter: true,
  dnsPrefetchControl: { allow: true },
  hidePoweredBy: true,
  noSniff: true,
  crossOriginEmbedderPolicy: false,
});

const BOT_PATTERNS = [
  /scrapy/i, /python-requests/i, /go-http/i, /java\//i,
  /curl\//i, /wget\//i, /libwww/i, /zgrab/i, /masscan/i,
];

function botDetection(req, res, next) {
  const ua = req.headers['user-agent'] || '';
  if (!ua) {
    res.setHeader('X-BingeBox-Client-Type', 'headless');
    return next();
  }
  if (BOT_PATTERNS.some(rx => rx.test(ua))) {
    return res.status(403).json({ error: 'forbidden', message: 'Automated clients are not permitted.' });
  }
  next();
}

const securityStack = [
  helmetMiddleware,
  additionalSecurityHeaders,
  botDetection,
  createRateLimiter(),
];

module.exports = securityStack;
module.exports.helmetMiddleware        = helmetMiddleware;
module.exports.createRateLimiter       = createRateLimiter;
module.exports.additionalSecurityHeaders = additionalSecurityHeaders;
module.exports.botDetection            = botDetection;
module.exports.cspConfig               = cspConfig;
module.exports.getRateLimitStore       = () => Object.fromEntries(RATE_STORE);
