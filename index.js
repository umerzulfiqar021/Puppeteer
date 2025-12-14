/**
 * Appwrite Function Entry Point
 * 
 * Handles HTTP requests for the Booking.com scraper API.
 */

const { scrapeBookingHotels, scrapeHotelDetails } = require('./scraper/booking');

/**
 * Build Booking.com search URL from parameters
 */
function buildSearchURL(params) {
  const { location, checkin, checkout, adults = 2, children = 0, rooms = 1 } = params;
  
  const base = 'https://www.booking.com/searchresults.html';
  const queryParams = new URLSearchParams({
    ss: location,
    checkin: checkin,
    checkout: checkout,
    group_adults: String(adults),
    no_rooms: String(rooms),
    group_children: String(children),
    lang: 'en-us',
    selected_currency: 'USD'
  });
  
  return `${base}?${queryParams.toString()}`;
}

/**
 * Main Appwrite function handler
 */
module.exports = async ({ req, res, log, error }) => {
  const path = req.path || '/';
  const method = req.method || 'GET';
  
  log(`[REQUEST] ${method} ${path}`);
  
  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  
  // Handle OPTIONS (preflight)
  if (method === 'OPTIONS') {
    return res.empty();
  }
  
  // Health check
  if (path === '/api/health' || path === '/health' || path === '/') {
    return res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      scraper: 'booking.com',
      endpoints: ['/api/health', '/api/hotels', '/api/hotel-details']
    }, 200, headers);
  }
  
  // Search hotels
  if (path === '/api/hotels' && method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      
      const { location, checkin, checkout, adults, children, rooms } = body;
      
      if (!location || !checkin || !checkout) {
        return res.json({
          success: false,
          error: 'Missing required fields: location, checkin, checkout'
        }, 400, headers);
      }
      
      log(`[SCRAPER] Searching hotels in: ${location}`);
      
      const searchURL = buildSearchURL({ location, checkin, checkout, adults, children, rooms });
      const startTime = Date.now();
      
      const hotels = await scrapeBookingHotels(searchURL);
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      return res.json({
        success: true,
        location,
        count: hotels.length,
        duration_seconds: parseFloat(duration),
        hotels
      }, 200, headers);
      
    } catch (err) {
      error(`[ERROR] ${err.message}`);
      return res.json({
        success: false,
        error: err.message
      }, 500, headers);
    }
  }
  
  // Hotel details
  if (path === '/api/hotel-details' && method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      
      const { url } = body;
      
      if (!url) {
        return res.json({
          success: false,
          error: 'Missing required field: url'
        }, 400, headers);
      }
      
      log(`[SCRAPER] Getting hotel details: ${url}`);
      
      const startTime = Date.now();
      const hotel = await scrapeHotelDetails(url);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      return res.json({
        success: true,
        hotel,
        duration: parseFloat(duration)
      }, 200, headers);
      
    } catch (err) {
      error(`[ERROR] ${err.message}`);
      return res.json({
        success: false,
        error: err.message
      }, 500, headers);
    }
  }
  
  // 404 Not Found
  return res.json({
    success: false,
    error: 'Not Found',
    available_endpoints: ['/api/health', '/api/hotels', '/api/hotel-details']
  }, 404, headers);
};
