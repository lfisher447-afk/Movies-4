const cors = require('cors');

// List of allowed origins. 
// It now checks for a CLIENT_URL environment variable you can set in Railway.
const allowedOrigins = [
  'http://localhost:3000',
  process.env.CLIENT_URL, 
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl) 
    // or if the origin is in our allowed list.
    if (!origin || allowedOrigins.includes(origin)) {
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
