/**
 * test_details.js
 * 
 * Verifies the hotel details scraper by fetching data for a specific hotel URL.
 */

require('dotenv').config();
const { scrapeHotelDetails } = require('./scraper/booking');

async function testDetails() {
  const url = 'https://www.booking.com/hotel/fr/grand-appartement-ternes.html?checkin=2026-03-01&checkout=2026-03-05&group_adults=2&no_rooms=1&group_children=0';
  console.log('[TEST] Scraping details for:', url);
  
  try {
    const start = Date.now();
    const result = await scrapeHotelDetails(url);
    const duration = (Date.now() - start) / 1000;
    
    console.log(`[TEST] Scraping complete in ${duration.toFixed(2)}s`);
    
    if (result && result.name && !result.name.toLowerCase().includes('largest selection')) {
      console.log('[TEST] Success! Hotel details:');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('[TEST] Failed to scrape details or missing essential data');
      console.log('[TEST] Extracted name:', result?.name);
      const facCount = result?.facilities ? result.facilities.length : 0;
      console.log('[TEST] Facilities count:', facCount);
    }
  } catch (error) {
    console.error('[TEST] Error during test:', error.message);
  }
}

testDetails();
