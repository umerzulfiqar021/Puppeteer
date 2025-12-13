/**
 * local_server.js
 * 
 * Simple HTTP server for testing the scraper locally.
 * Accepts POST requests with JSON body containing location.
 * 
 * Usage: node local_server.js
 * Test: curl -X POST http://localhost:3000/scrape -H "Content-Type: application/json" -d '{"location":"Paris"}'
 */

const http = require('http');
const { scrapeBookingHotels } = require('./scraper/booking');

// Server configuration
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

/**
 * Build a Booking.com search URL from location name.
 * @param {string} location - Search location
 * @returns {string} Complete search URL
 */
function buildSearchURL(location) {
  const base = 'https://www.booking.com/searchresults.html';
  
  const now = new Date();
  const checkin = new Date(now);
  checkin.setDate(now.getDate() + 1);
  const checkout = new Date(checkin);
  checkout.setDate(checkin.getDate() + 2);
  
  const formatDate = (d) => d.toISOString().split('T')[0];
  
  const params = new URLSearchParams({
    ss: location,
    checkin: formatDate(checkin),
    checkout: formatDate(checkout),
    group_adults: '2',
    no_rooms: '1',
    group_children: '0',
    lang: 'en-us'
  });
  
  return `${base}?${params.toString()}`;
}

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
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * HTTP request handler
 */
async function requestHandler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Only handle POST /scrape
  if (req.method !== 'POST' || req.url !== '/scrape') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use POST /scrape' }));
    return;
  }
  
  try {
    // Parse request body
    const body = await parseBody(req);
    
    if (!body.location) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing "location" field' }));
      return;
    }
    
    console.log('[SERVER] Scraping hotels for:', body.location);
    
    // Build URL and scrape
    const searchURL = buildSearchURL(body.location);
    const hotels = await scrapeBookingHotels(searchURL);
    
    // Send response
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      location: body.location,
      count: hotels.length,
      hotels: hotels
    }));
    
  } catch (error) {
    console.error('[SERVER] Error:', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

// Create and start server
const server = http.createServer(requestHandler);

server.listen(PORT, HOST, () => {
  console.log(`[SERVER] Booking.com scraper server running at http://${HOST}:${PORT}`);
  console.log('[SERVER] Endpoints:');
  console.log('  POST /scrape - Scrape hotels for a location');
  console.log('  Body: {"location": "city name"}');
});
