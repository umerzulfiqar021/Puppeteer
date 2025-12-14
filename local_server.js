/**
 * local_server.js
 * 
 * HTTP API server for Booking.com hotel scraper.
 * Accepts POST requests with location and returns hotel data.
 * Designed to receive requests from your backend.
 * 
 * Usage: node local_server.js
 * 
 * Endpoints:
 *   POST /api/hotels - Scrape hotels for a location
 *   GET  /api/health - Health check endpoint
 */

require('dotenv').config();
const http = require('http');
const { scrapeBookingHotels } = require('./scraper/booking');

// Server configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Parse request body as JSON
 * @param {IncomingMessage} req - HTTP request
 * @returns {Promise<object>} Parsed JSON body
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        if (!body) {
          resolve({});
        } else {
          resolve(JSON.parse(body));
        }
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

/**
 * Handle /api/hotels endpoint
 * 
 * Request body:
 * {
 *   "location": "Paris",           // Required: city/region to search
 *   "checkin": "2025-01-15",       // Optional: check-in date (YYYY-MM-DD)
 *   "checkout": "2025-01-17",      // Optional: check-out date (YYYY-MM-DD)
 *   "adults": 2,                   // Optional: number of adults (default: 2)
 *   "rooms": 1,                    // Optional: number of rooms (default: 1)
 *   "useZyte": false               // Optional: force Zyte proxy usage
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "location": "Paris",
 *   "count": 25,
 *   "hotels": [...]
 * }
 */
async function handleHotelsEndpoint(req, res) {
  try {
    // Parse request body
    const body = await parseBody(req);
    
    // Validate required field
    if (!body.location || typeof body.location !== 'string') {
      return sendJSON(res, 400, {
        success: false,
        error: 'Missing or invalid "location" field. Expected a string.'
      });
    }
    
    const location = body.location.trim();
    if (!location) {
      return sendJSON(res, 400, {
        success: false,
        error: 'Location cannot be empty'
      });
    }
    
    console.log(`[SERVER] Received request for location: ${location}`);
    
    // Build options from request body
    const options = {
      checkin: body.checkin || null,
      checkout: body.checkout || null,
      adults: body.adults || 2,
      rooms: body.rooms || 1,
      useZyte: body.useZyte || false
    };
    
    // Run the scraper
    const startTime = Date.now();
    const hotels = await scrapeBookingHotels(location, options);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`[SERVER] Scraped ${hotels.length} hotels in ${duration}s`);
    
    // Send response
    return sendJSON(res, 200, {
      success: true,
      location: location,
      count: hotels.length,
      duration_seconds: parseFloat(duration),
      hotels: hotels
    });
    
  } catch (error) {
    console.error('[SERVER] Error:', error.message);
    return sendJSON(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Handle /api/health endpoint
 */
function handleHealthEndpoint(req, res) {
  return sendJSON(res, 200, {
    status: 'ok',
    service: 'booking-scraper',
    timestamp: new Date().toISOString(),
    zyte_configured: !!process.env.ZYTE_API_KEY
  });
}

/**
 * Main request handler
 */
async function requestHandler(req, res) {
  const url = req.url.split('?')[0];  // Remove query params
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }
  
  // Route requests
  if (url === '/api/hotels' && req.method === 'POST') {
    return handleHotelsEndpoint(req, res);
  }
  
  if (url === '/api/health' && req.method === 'GET') {
    return handleHealthEndpoint(req, res);
  }
  
  // Legacy endpoint for backwards compatibility
  if (url === '/scrape' && req.method === 'POST') {
    return handleHotelsEndpoint(req, res);
  }
  
  // 404 for unknown routes
  return sendJSON(res, 404, {
    success: false,
    error: 'Not found',
    available_endpoints: [
      'POST /api/hotels - Scrape hotels for a location',
      'GET  /api/health - Health check'
    ]
  });
}

// Create and start server
const server = http.createServer(requestHandler);

server.listen(PORT, HOST, () => {
  console.log('====================================');
  console.log('  Booking.com Hotel Scraper API');
  console.log('====================================');
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  POST /api/hotels - Scrape hotels');
  console.log('  GET  /api/health - Health check');
  console.log('');
  console.log('Example request:');
  console.log(`  curl -X POST http://localhost:${PORT}/api/hotels \\`);
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"location":"Paris"}\'');
  console.log('');
  console.log('Zyte API:', process.env.ZYTE_API_KEY ? 'Configured' : 'Not configured');
  console.log('====================================');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SERVER] Received SIGTERM, shutting down...');
  server.close(() => {
    console.log('[SERVER] Server closed');
    process.exit(0);
  });
});
