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
const { scrapeBookingHotels, scrapeHotelDetails } = require('./scraper/booking');

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
      children: body.children || 0,
      rooms: body.rooms || 1,
      useZyte: body.useZyte || false
    };
    
    // Run the scraper
    const startTime = Date.now();
    const result = await scrapeBookingHotels(location, options);
    const hotels = result.hotels || [];
    const debugInfo = result.debugInfo || {};
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`[SERVER] Scraped ${hotels.length} hotels in ${duration}s`);
    
    // Send response
    return sendJSON(res, 200, {
      success: true,
      location: location,
      count: hotels.length,
      duration_seconds: parseFloat(duration),
      hotels: hotels,
      debug: debugInfo
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
 * Handle /api/hotel-details endpoint
 * 
 * Request body:
 * {
 *   "url": "https://www.booking.com/hotel/ae/..."  // Required: hotel page URL
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "hotel": { name, address, rating, facilities, rooms, photos, ... }
 * }
 */
async function handleHotelDetailsEndpoint(req, res) {
  try {
    const body = await parseBody(req);
    
    if (!body.url || typeof body.url !== 'string') {
      return sendJSON(res, 400, {
        success: false,
        error: 'Missing or invalid "url" field. Expected a Booking.com hotel URL.'
      });
    }
    
    const hotelURL = body.url.trim();
    
    // Validate it's a booking.com hotel URL
    if (!hotelURL.includes('booking.com/hotel/')) {
      return sendJSON(res, 400, {
        success: false,
        error: 'Invalid URL. Expected a Booking.com hotel URL (e.g., https://www.booking.com/hotel/...)'
      });
    }
    
    console.log(`[SERVER] Received request for hotel details: ${hotelURL.substring(0, 80)}...`);
    
    const startTime = Date.now();
    const hotelDetails = await scrapeHotelDetails(hotelURL, { useZyte: body.useZyte });
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`[SERVER] Scraped hotel details in ${duration}s`);
    
    return sendJSON(res, 200, {
      success: true,
      duration_seconds: parseFloat(duration),
      hotel: hotelDetails
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
 * Handle /api/weather endpoint
 */
async function handleWeatherEndpoint(req, res) {
  try {
    const body = await parseBody(req);
    const location = body.location || 'Paris';
    
    console.log(`[SERVER] Received weather request for: ${location}`);
    
    const startTime = Date.now();
    const weatherData = await require('./scraper/booking').scrapeWeather(location);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    return sendJSON(res, 200, {
      success: true,
      location,
      duration_seconds: parseFloat(duration),
      weather: weatherData
    });
  } catch (error) {
    console.error('[SERVER] Weather error:', error.message);
    return sendJSON(res, 500, {
      success: false,
      error: error.message
    });
  }
}

// In-memory store for reset codes (Temporary - should use DB)
const resetCodes = new Map();

/**
 * Handle /api/forgot-password endpoint
 */
async function handleForgotPasswordEndpoint(req, res) {
  try {
    const body = await parseBody(req);
    const email = body.email;
    
    if (!email) {
      return sendJSON(res, 400, { success: false, error: 'Email is required' });
    }
    
    console.log(`[SERVER] Forgot password request for: ${email}`);
    
    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    resetCodes.set(email, { code, expires: Date.now() + 15 * 60 * 1000 }); // 15 min expiry
    
    console.log(`[AUTH] DEBUG: Verification code for ${email} is: ${code}`);
    
    // Placeholder for email sending logic (as requested to use same as signup)
    // In a real app, you would use nodemailer here:
    // await sendVerificationEmail(email, code);
    
    return sendJSON(res, 200, {
      success: true,
      message: 'Verification code sent to your email (DEBUG: check server logs)',
      email
    });
  } catch (error) {
    return sendJSON(res, 500, { success: false, error: error.message });
  }
}

/**
 * Handle /api/reset-password endpoint
 */
async function handleResetPasswordEndpoint(req, res) {
  try {
    const body = await parseBody(req);
    const { email, code, newPassword } = body;
    
    if (!email || !code || !newPassword) {
      return sendJSON(res, 400, { success: false, error: 'Email, code, and newPassword are required' });
    }
    
    const stored = resetCodes.get(email);
    
    if (!stored || stored.code !== code || Date.now() > stored.expires) {
      return sendJSON(res, 400, { success: false, error: 'Invalid or expired verification code' });
    }
    
    console.log(`[SERVER] Password updated for: ${email}`);
    
    // Placeholder for DB update
    // await User.updatePassword(email, newPassword);
    
    resetCodes.delete(email); // Code used
    
    return sendJSON(res, 200, {
      success: true,
      message: 'Password has been updated successfully'
    });
  } catch (error) {
    return sendJSON(res, 500, { success: false, error: error.message });
  }
}

/**
 * Main request handler
 */
async function requestHandler(req, res) {
  let url = req.url.split('?')[0];  // Remove query params
  
  // Normalize URL: remove trailing slash (unless root) and replace multiple slashes
  url = url.replace(/\/+/g, '/');
  if (url.length > 1 && url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  
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
  
  // Handle root path
  if (url === '/' && req.method === 'GET') {
    return sendJSON(res, 200, {
      success: true,
      message: 'Booking.com Scraper & Utility API is running',
      endpoints: {
        'POST /api/hotels': 'Scrape hotels for a location',
        'POST /api/hotel-details': 'Get detailed info for a specific hotel',
        'POST /api/weather': 'Get weather data for a location',
        'POST /api/forgot-password': 'Request password reset code',
        'POST /api/reset-password': 'Reset password with code',
        'GET /api/health': 'Health check'
      },
      documentation: 'https://github.com/umerzulfiqar021/Puppeteer'
    });
  }

  // Handle incorrect methods for API endpoints
  const postOnlyEndpoints = ['/api/hotels', '/api/hotel-details', '/api/weather', '/api/forgot-password', '/api/reset-password'];
  if (postOnlyEndpoints.includes(url) && req.method !== 'POST') {
    console.log(`[SERVER] Method Not Allowed: Received ${req.method} for ${url}`);
    return sendJSON(res, 405, {
      success: false,
      error: `Method Not Allowed. This endpoint requires POST method. Received: ${req.method}`,
      hint: 'Check your request method and try again.'
    });
  }

  // Route requests
  if (url === '/api/hotels' && req.method === 'POST') {
    return handleHotelsEndpoint(req, res);
  }
  
  if (url === '/api/hotel-details' && req.method === 'POST') {
    return handleHotelDetailsEndpoint(req, res);
  }
  
  if (url === '/api/weather' && req.method === 'POST') {
    return handleWeatherEndpoint(req, res);
  }
  
  if (url === '/api/forgot-password' && req.method === 'POST') {
    return handleForgotPasswordEndpoint(req, res);
  }
  
  if (url === '/api/reset-password' && req.method === 'POST') {
    return handleResetPasswordEndpoint(req, res);
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
      'POST /api/hotel-details - Get detailed info for a specific hotel',
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
  console.log('  POST /api/hotels        - Scrape hotels list');
  console.log('  POST /api/hotel-details - Get hotel details');
  console.log('  GET  /api/health        - Health check');
  console.log('');
  console.log('Example requests:');
  console.log(`  curl -X POST http://localhost:${PORT}/api/hotels \\`);
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"location":"Paris"}\'');
  console.log('');
  console.log(`  curl -X POST http://localhost:${PORT}/api/hotel-details \\`);
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"url":"https://www.booking.com/hotel/..."}\'');
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
