/**
 * config.js
 * 
 * Central configuration for the Booking.com scraper.
 * Contains User-Agent pool, selectors, and tunable parameters.
 */

// Pool of common desktop User-Agent strings for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15'
];

// CSS selectors for Booking.com (using data-testid where available for stability)
const SELECTORS = {
  // Main hotel card container
  hotelCard: '[data-testid="property-card"]',
  
  // Fallback selectors if data-testid not present
  hotelCardFallback: '.sr_property_block, .c-sr-hotel-card, [data-hotelid]',
  
  // Within each card:
  hotelName: '[data-testid="title"]',
  hotelNameFallback: '.sr-hotel__name, .fcab3ed991, h3',
  
  hotelLink: '[data-testid="title"] a, a[data-testid="property-card-desktop-single-image"]',
  hotelLinkFallback: 'a.hotel_name_link, a[href*="/hotel/"]',
  
  hotelImage: '[data-testid="image"] img, img[data-testid]',
  hotelImageFallback: '.hotel_image img, .sr_item_photo img, img',
  
  hotelRating: '[data-testid="review-score"] > div:first-child',
  hotelRatingFallback: '.bui-review-score__badge, .review-score-badge',
  
  hotelReviewCount: '[data-testid="review-score"] > div:last-child',
  hotelReviewCountFallback: '.bui-review-score__text, .review-score-widget__subtext',
  
  hotelLocation: '[data-testid="address"]',
  hotelLocationFallback: '.sr_card_address_line, .address, [data-testid="distance"]',
  
  hotelPrice: '[data-testid="price-and-discounted-price"]',
  hotelPriceFallback: '.bui-price-display__value, .prco-valign-middle-helper, [data-testid="price-for-x-nights"]',
  
  // Loading/result container
  resultsContainer: '[data-testid="property-card-container"], #hotellist_inner, .sr_property_block_wrapper'
};

// Timing configuration (in milliseconds)
const TIMING = {
  minDelay: 2500,
  maxDelay: 5000,
  navigationTimeout: 90000,
  selectorTimeout: 20000,
  scrollPause: 1200,
  scrollIterations: 12
};

// Resource types to block (speeds up scraping, reduces bot footprint)
const BLOCKED_RESOURCES = [
  'image',
  'stylesheet',
  'font',
  'media'
];

/**
 * Get a random User-Agent from the pool
 * @returns {string} Random User-Agent string
 */
function getRandomUserAgent() {
  const index = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[index];
}

/**
 * Generate a random delay within configured bounds
 * @param {number} min - Minimum delay in ms (optional, uses TIMING.minDelay)
 * @param {number} max - Maximum delay in ms (optional, uses TIMING.maxDelay)
 * @returns {Promise} Promise that resolves after the delay
 */
function randomDelay(min = TIMING.minDelay, max = TIMING.maxDelay) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

// Export all configuration
module.exports = {
  USER_AGENTS,
  SELECTORS,
  TIMING,
  BLOCKED_RESOURCES,
  getRandomUserAgent,
  randomDelay
};
