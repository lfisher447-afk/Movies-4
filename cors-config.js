// cors-config.js
const cors = require('cors');

// List of allowed origins (domains).
// IMPORTANT: Add the final URL Railway gives you to this list!
const allowedOrigins = [
  // Example: 'https://bingebox-omega-production.up.railway.app',
  'http://localhost:3000',
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('This request was blocked by CORS.'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

module.exports = cors(corsOptions);