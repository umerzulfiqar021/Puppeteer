/**
 * index.js
 * 
 * Main entry point for the Booking.com scraper.
 * Reads input from stdin (JSON with location) and outputs hotel data.
 * 
 * @module scraper/index
 */

// Load environment variables from .env file
require('dotenv').config();

// Import the main scraping function
const { scrapeBookingHotels } = require('./booking');

/**
 * Build a Booking.com search URL from location name.
 * Adds default check-in/check-out dates if not provided.
 * 
 * @param {string} location - Search location (city, region, etc.)
 * @returns {string} Complete Booking.com search URL
 */
function buildSearchURL(location) {
  // Base URL for Booking.com search
  const base = 'https://www.booking.com/searchresults.html';
  
  // Calculate default dates (tomorrow + 2 nights)
  const now = new Date();
  const checkin = new Date(now);
  checkin.setDate(now.getDate() + 1);
  const checkout = new Date(checkin);
  checkout.setDate(checkin.getDate() + 2);
  
  // Format date as YYYY-MM-DD
  const formatDate = (d) => d.toISOString().split('T')[0];
  
  // Build query parameters
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
 * Main function - reads input and runs scraper.
 */
async function main() {
  console.log('[MAIN] Booking.com Hotel Scraper');
  console.log('[MAIN] Reading input from stdin...');
  
  // Read JSON input from stdin
  let inputData = '';
  
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }
  
  // Parse input JSON
  let input;
  try {
    input = JSON.parse(inputData.trim());
  } catch (e) {
    console.error('[MAIN] Error: Invalid JSON input');
    console.error('[MAIN] Expected format: {"location": "city name"}');
    process.exit(1);
  }
  
  // Validate input
  if (!input.location) {
    console.error('[MAIN] Error: Missing "location" field in input');
    process.exit(1);
  }
  
  console.log('[MAIN] Searching for hotels in:', input.location);
  
  // Build search URL
  const searchURL = buildSearchURL(input.location);
  console.log('[MAIN] Search URL:', searchURL);
  
  try {
    // Run the scraper
    const hotels = await scrapeBookingHotels(searchURL);
    
    // Output results as JSON
    console.log('[MAIN] Scraping complete. Results:');
    console.log(JSON.stringify(hotels, null, 2));
    
    // Exit with success
    process.exit(0);
    
  } catch (error) {
    console.error('[MAIN] Scraping failed:', error.message);
    process.exit(1);
  }
}

// Run main function
main();
