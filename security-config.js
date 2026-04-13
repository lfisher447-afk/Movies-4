// security-config.js
const helmet = require('helmet');

// Configure Helmet's Content Security Policy (CSP)
const contentSecurityPolicy = {
  directives: {
    // By default, allow loading content from the same origin ('self')
    defaultSrc: ["'self'"],
    
    // Allow scripts from 'self' and from your specific CDNs
    scriptSrc: [
      "'self'",
      'cdn.tailwindcss.com',
      'unpkg.com',
      'cdn.jsdelivr.net'
    ],
    
    // Allow styles from 'self', your CDNs, and inline styles (needed for some libraries)
    styleSrc: [
      "'self'",
      "'unsafe-inline'", // Allows inline styles
      'fonts.googleapis.com',
      'cdnjs.cloudflare.com'
    ],
    
    // Allow fonts from 'self' and Google Fonts
    fontSrc: ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com'],
    
    // Allow images from 'self' and the TMDB image CDN
    imgSrc: ["'self'", 'image.tmdb.org', 'api.dicebear.com', 'via.placeholder.com'],
    
    // Allow connecting to 'self' and the TMDB API
    connectSrc: ["'self'", 'api.themoviedb.org'],

    // Allow iframes from a wide range of common video embed sources
    frameSrc: [
        "'self'", 
        "*.vidsrc.pro",
        "*.vidsrc.me",
        "*.vidsrc.cc",
        "*.vidsrc.icu",
        "*.vidlink.pro",
        "*.videasy.net",
        "*.multiembed.mov",
        "*.autoembed.co",
        "*.2embed.cc",
        "*.smashy.stream",
        "*.moviesapi.club",
        "*.filmku.stream",
        "*.blackbox.wtf",
        "*.vidcloud.co",
        "*.vidsrc.vip"
    ],
    objectSrc: ["'none'"], // Disallow <object>, <embed>, <applet> tags
    upgradeInsecureRequests: [], // Enforce HTTPS
  },
};

// Export the configured Helmet middleware
module.exports = helmet({
  contentSecurityPolicy: contentSecurityPolicy,
});