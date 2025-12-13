/**
 * booking.js
 * 
 * Core scraper module for Booking.com hotel data extraction.
 * Uses puppeteer-extra with stealth plugin for anti-bot evasion.
 * 
 * @module scraper/booking
 */

// Import puppeteer-extra for enhanced functionality
const puppeteer = require('puppeteer-extra');

// Import stealth plugin to bypass bot detection
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Import configuration
const { 
  TIMING, 
  BLOCKED_RESOURCES, 
  getRandomUserAgent, 
  randomDelay 
} = require('./config');

// Apply stealth plugin to puppeteer instance
puppeteer.use(StealthPlugin());

/**
 * Main scraping function for Booking.com hotel listings.
 * 
 * @param {string} searchURL - Full Booking.com search results URL
 * @returns {Promise<Array>} Array of hotel objects with extracted data
 */
async function scrapeBookingHotels(searchURL) {
  console.log('[SCRAPER] Starting Booking.com scraper...');
  console.log('[SCRAPER] Target URL:', searchURL);
  
  const userAgent = getRandomUserAgent();
  console.log('[SCRAPER] Using User-Agent:', userAgent.substring(0, 50) + '...');
  
  let browser = null;
  
  try {
    // Launch browser with stealth configuration
    console.log('[SCRAPER] Launching browser...');
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const page = await browser.newPage();
    
    // Configure page
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    
    // Navigate to search URL
    console.log('[SCRAPER] Navigating to search URL...');
    await randomDelay(500, 1500);
    
    await page.goto(searchURL, {
      waitUntil: 'networkidle2',
      timeout: TIMING.navigationTimeout
    });
    
    console.log('[SCRAPER] Page loaded successfully');
    
    // Handle consent dialogs
    console.log('[SCRAPER] Checking for consent dialogs...');
    await dismissOverlays(page);
    
    // Wait for hotel listings
    console.log('[SCRAPER] Waiting for hotel listings...');
    
    try {
      await page.waitForSelector('[data-testid="property-card"]', { timeout: TIMING.selectorTimeout });
      console.log('[SCRAPER] Hotel cards detected');
    } catch (e) {
      console.log('[SCRAPER] No hotel cards found after waiting');
      return [];
    }
    
    // Scroll to load lazy content
    console.log('[SCRAPER] Scrolling to load lazy content...');
    await autoScroll(page, TIMING.scrollIterations, TIMING.scrollPause);
    await randomDelay(2000, 3000);
    
    // Extract hotel data
    console.log('[SCRAPER] Extracting hotel data...');
    
    const hotels = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('[data-testid="property-card"]');
      
      cards.forEach((card) => {
        try {
          // Extract hotel name from data-testid="title"
          let name = null;
          const titleEl = card.querySelector('[data-testid="title"]');
          if (titleEl) {
            name = titleEl.textContent.trim();
          }
          
          // Extract hotel link from data-testid="title-link"
          let link = null;
          const titleLink = card.querySelector('[data-testid="title-link"]');
          if (titleLink) {
            link = titleLink.href;
          }
          if (!link) {
            const anyHotelLink = card.querySelector('a[href*="/hotel/"]');
            if (anyHotelLink) link = anyHotelLink.href;
          }
          
          // Extract hotel image from data-testid="image"
          let pictureUrl = null;
          const imageContainer = card.querySelector('[data-testid="image"]');
          if (imageContainer) {
            const img = imageContainer.querySelector('img');
            if (img) {
              pictureUrl = img.src || img.getAttribute('data-src');
            }
          }
          if (!pictureUrl) {
            const anyImg = card.querySelector('img');
            if (anyImg) pictureUrl = anyImg.src || anyImg.getAttribute('data-src');
          }
          
          // Extract rating from data-testid="review-score"
          let rating = null;
          let reviewsCount = null;
          const reviewScore = card.querySelector('[data-testid="review-score"]');
          if (reviewScore) {
            const text = reviewScore.textContent;
            // Format: "Scored 8.3 8.3Very Good 231 reviews"
            const ratingMatch = text.match(/(\d+\.?\d*)/);
            if (ratingMatch) {
              rating = parseFloat(ratingMatch[1]);
            }
            const reviewsMatch = text.match(/(\d[\d,]*)\s*review/i);
            if (reviewsMatch) {
              reviewsCount = parseInt(reviewsMatch[1].replace(/,/g, ''), 10);
            }
          }
          
          // Extract location from data-testid="address" and data-testid="distance"
          let location = null;
          const address = card.querySelector('[data-testid="address"]');
          if (address) {
            location = address.textContent.trim();
          }
          const distance = card.querySelector('[data-testid="distance"]');
          if (distance) {
            const distText = distance.textContent.trim();
            location = location ? location + ' - ' + distText : distText;
          }
          
          // Extract price from data-testid="price-and-discounted-price"
          let pricePerNight = null;
          const priceEl = card.querySelector('[data-testid="price-and-discounted-price"]');
          if (priceEl) {
            const priceText = priceEl.textContent.trim();
            // Format: "PKR 25,344"
            const priceMatch = priceText.match(/[\d,]+/);
            if (priceMatch) {
              pricePerNight = priceMatch[0].replace(/,/g, '');
            }
          }
          
          // Only add if we have a name
          if (name) {
            results.push({
              name: name,
              link: link || null,
              picture_url: pictureUrl || null,
              rating: rating,
              reviews_count: reviewsCount,
              location: location || null,
              price_per_night: pricePerNight
            });
          }
        } catch (err) {
          // Skip cards that fail extraction
        }
      });
      
      return results;
    });
    
    console.log('[SCRAPER] Successfully extracted ' + hotels.length + ' hotels');
    
    if (hotels.length > 0) {
      console.log('[SCRAPER] Sample hotel:', JSON.stringify(hotels[0], null, 2));
    }
    
    return hotels;
    
  } catch (error) {
    console.error('[SCRAPER] Error during scraping:', error.message);
    throw error;
    
  } finally {
    if (browser) {
      console.log('[SCRAPER] Closing browser...');
      await browser.close();
    }
  }
}

/**
 * Dismiss cookie consent banners and overlays.
 */
async function dismissOverlays(page) {
  const dismissSelectors = [
    '#onetrust-accept-btn-handler',
    '[data-testid="accept-btn"]',
    'button[title="Accept"]',
    '.fc-cta-consent',
    '#didomi-notice-agree-button',
    '[aria-label="Dismiss sign-in info."]',
    'button[aria-label="Close"]',
    '.bui-modal__close'
  ];
  
  for (const selector of dismissSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        await randomDelay(200, 500);
        await element.click();
        console.log('[SCRAPER] Dismissed overlay with selector:', selector);
        await randomDelay(300, 700);
      }
    } catch (e) {
      // Ignore errors
    }
  }
}

/**
 * Scroll page to trigger lazy loading.
 */
async function autoScroll(page, iterations, pauseTime) {
  await page.evaluate(async (iters, pause) => {
    for (let i = 0; i < iters; i++) {
      window.scrollBy(0, window.innerHeight * 0.8);
      await new Promise(resolve => setTimeout(resolve, pause));
    }
    window.scrollTo(0, 0);
  }, iterations, pauseTime);
  
  await randomDelay(1000, 2000);
}

module.exports = { scrapeBookingHotels };
