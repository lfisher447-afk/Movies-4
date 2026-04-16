'use strict';

// 1. Load environment variables
try { require('dotenv').config(); } catch (_) {}

const express = require('express');
const path = require('path');
const fs = require('fs');

// 2. Ensure log directory exists (Prevents crash if logger tries to write)
const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR);
}

// 3. Import BingeBox custom modules
const logger         = require('./logger');
const appLogger      = logger.root;
const securityStack  = require('./security-config');
const corsMiddleware = require('./cors-config');
const cacheManager   = require('./cache-manager'); // Mounts to /api/v1/cache
const apiProxy       = require('./api-proxy');     // Mounts to /api/v1/tmdb
const healthMonitor  = require('./health-monitor');

const app = express();

// 4. Constants
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// 5. Middleware Stack
app.use(express.json());

// Enable compression if available
try {
  const compression = require('compression');
  app.use(compression());
} catch (_) {
  appLogger.warn('Compression module not found, skipping...');
}

// Security & CORS
app.use(corsMiddleware);
securityStack.forEach(mw => app.use(mw));

// 6. Routes
// Health check MUST be active for Railway to mark the app as "Up"
app.use('/health', healthMonitor); 
app.use('/api/v1', apiProxy);
app.use('/api/v1/cache', cacheManager);

// 7. Static Files (Connects index.html and your JS)
app.use(express.static(PUBLIC_DIR));

// 8. Catch-all for SPA (Optional: ensures refreshes on sub-pages work)
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// 9. Boot the Server
const server = app.listen(PORT, '0.0.0.0', () => {
  appLogger.info(`BingeBox Omega is live on port ${PORT}`);
  appLogger.info(`Public directory: ${PUBLIC_DIR}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  appLogger.info('SIGTERM received. Shutting down...');
  server.close(() => process.exit(0));
});
