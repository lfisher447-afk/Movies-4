const express = require('express');
const path = require('path');
const securityMiddleware = require('./security-config'); 
const corsMiddleware = require('./cors-config');         
const app = express();

// Railway automatically assigns a PORT environment variable
const PORT = process.env.PORT || 3000;

// --- Middleware ---
// 1. Apply Helmet to set crucial security headers first.
app.use(securityMiddleware);

// 2. Apply CORS to control which domains can access the server.
app.use(corsMiddleware);

// 3. Serve all static files (like index.html) from the 'public' directory.
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
// A catch-all route to always serve the main HTML file from the public folder.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`BingeBox Omega server is secure and running on port ${PORT}`);
});
