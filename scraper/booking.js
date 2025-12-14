/**
 * booking.js
 * 
 * Core scraper module for Booking.com hotel data extraction.
 * Uses puppeteer-extra with stealth plugin for anti-bot evasion.
 * Supports Zyte API browserHtml for production use.
 * 
 * @module scraper/booking
 */

require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { TIMING, getRandomUserAgent, randomDelay } = require('./config');

puppeteer.use(StealthPlugin());

/**
 * Build Booking.com search URL from location and optional dates.
 */
function buildSearchURL(location, options = {}) {
  const base = 'https://www.booking.com/searchresults.html';
  
  const now = new Date();
  const defaultCheckin = new Date(now);
  defaultCheckin.setDate(now.getDate() + 1);
  const defaultCheckout = new Date(defaultCheckin);
  defaultCheckout.setDate(defaultCheckin.getDate() + 2);
  
  const formatDate = (d) => d.toISOString().split('T')[0];
  
  const params = new URLSearchParams({
    ss: location,
    checkin: options.checkin || formatDate(defaultCheckin),
    checkout: options.checkout || formatDate(defaultCheckout),
    group_adults: String(options.adults || 2),
    no_rooms: String(options.rooms || 1),
    group_children: '0',
    lang: 'en-us'
  });
  
  return `${base}?${params.toString()}`;
}

/**
 * Scrape using Zyte API browserHtml endpoint (recommended for production)
 */
async function scrapeWithZyte(searchURL, zyteApiKey) {
  console.log('[ZYTE] Using Zyte API browserHtml...');
  console.log('[ZYTE] Target URL:', searchURL);
  
  const response = await fetch('https://api.zyte.com/v1/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(zyteApiKey + ':').toString('base64')
    },
    body: JSON.stringify({
      url: searchURL,
      browserHtml: true,
      javascript: true
      // Note: Actions removed - Booking.com needs special handling
      // The page should load with JS enabled
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Zyte API error: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  console.log('[ZYTE] Received browserHtml response');
  console.log('[ZYTE] Response URL:', data.url);
  console.log('[ZYTE] HTML length:', data.browserHtml?.length || 0);
  
  // Check if we got redirected to homepage (search failed)
  if (data.url && data.url.includes('index.html') && data.url.includes('errorc_searchstring')) {
    console.log('[ZYTE] Warning: Search may have failed, trying to extract anyway...');
  }
  
  // Parse HTML with regex
  const html = data.browserHtml;
  const hotels = extractHotelsFromHTML(html);
  
  console.log('[ZYTE] Extracted', hotels.length, 'hotels');
  return hotels;
}

/**
 * Decode HTML entities (e.g., &amp; -> &)
 */
function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Clean hotel URL - remove tracking params, keep only essential booking params
 */
function cleanHotelUrl(url) {
  if (!url) return url;
  try {
    // First decode any HTML entities
    url = decodeHtmlEntities(url);
    
    // Parse the URL
    const urlObj = new URL(url);
    
    // Keep only essential params for booking
    const essentialParams = ['checkin', 'checkout', 'group_adults', 'no_rooms', 'group_children'];
    const newParams = new URLSearchParams();
    
    for (const param of essentialParams) {
      if (urlObj.searchParams.has(param)) {
        newParams.set(param, urlObj.searchParams.get(param));
      }
    }
    
    // Return clean URL: base + essential params only
    return `${urlObj.origin}${urlObj.pathname}${newParams.toString() ? '?' + newParams.toString() : ''}`;
  } catch (e) {
    return url;
  }
}

/**
 * Extract hotel data from HTML string (for Zyte mode)
 */
function extractHotelsFromHTML(html) {
  const hotels = [];
  
  // Simple regex-based extraction for Zyte HTML response
  const cardRegex = /<div[^>]*data-testid="property-card"[^>]*>([\s\S]*?)(?=<div[^>]*data-testid="property-card"|$)/gi;
  let match;
  
  while ((match = cardRegex.exec(html)) !== null) {
    const cardHtml = match[0];
    
    try {
      // Extract name
      const nameMatch = cardHtml.match(/data-testid="title"[^>]*>([^<]+)</);
      const name = nameMatch ? decodeHtmlEntities(nameMatch[1].trim()) : null;
      
      // Extract link - clean and simplify URL
      const linkMatch = cardHtml.match(/href="(https:\/\/www\.booking\.com\/hotel\/[^"]+)"/);
      let link = linkMatch ? cleanHotelUrl(linkMatch[1]) : null;
      
      // Extract image - try multiple patterns
      let pictureUrl = null;
      const imgPatterns = [
        /data-testid="image"[\s\S]*?<img[^>]*src="([^"]+bstatic\.com[^"]+)"/i,
        /<img[^>]*data-testid="image"[^>]*src="([^"]+bstatic\.com[^"]+)"/i,
        /src="(https:\/\/cf\.bstatic\.com\/xdata\/images\/hotel[^"]+)"/i,
        /<img[^>]*src="([^"]+bstatic\.com\/xdata\/images\/hotel[^"]+)"/i
      ];
      for (const pattern of imgPatterns) {
        const imgMatch = cardHtml.match(pattern);
        if (imgMatch && imgMatch[1]) {
          pictureUrl = decodeHtmlEntities(imgMatch[1]);
          break;
        }
      }
      
      // Extract rating
      const ratingMatch = cardHtml.match(/data-testid="review-score"[\s\S]*?(\d+\.?\d*)/);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
      
      // Extract reviews count
      const reviewsMatch = cardHtml.match(/(\d[\d,]*)\s*review/i);
      const reviewsCount = reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, ''), 10) : null;
      
      // Extract location
      const addressMatch = cardHtml.match(/data-testid="address"[^>]*>([^<]+)</);
      const distanceMatch = cardHtml.match(/data-testid="distance"[^>]*>([^<]+)</);
      let location = addressMatch ? decodeHtmlEntities(addressMatch[1].trim()) : null;
      if (distanceMatch) {
        const dist = decodeHtmlEntities(distanceMatch[1].trim());
        location = location ? `${location} - ${dist}` : dist;
      }
      
      // Extract price
      const priceMatch = cardHtml.match(/data-testid="price-and-discounted-price"[\s\S]*?([\d,]+)/);
      const pricePerNight = priceMatch ? priceMatch[1].replace(/,/g, '') : null;
      
      if (name) {
        hotels.push({ name, link, picture_url: pictureUrl, rating, reviews_count: reviewsCount, location, price_per_night: pricePerNight });
      }
    } catch (e) {
      // Skip malformed cards
    }
  }
  
  return hotels;
}

/**
 * Scrape using local Puppeteer (for development/testing)
 */
async function scrapeWithPuppeteer(searchURL) {
  console.log('[SCRAPER] Using local Puppeteer...');
  
  const userAgent = getRandomUserAgent();
  console.log('[SCRAPER] User-Agent:', userAgent.substring(0, 50) + '...');
  
  const browser = await puppeteer.launch({
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
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    
    console.log('[SCRAPER] Navigating to search URL...');
    await randomDelay(500, 1500);
    
    await page.goto(searchURL, { waitUntil: 'networkidle2', timeout: TIMING.navigationTimeout });
    console.log('[SCRAPER] Page loaded');
    
    // Dismiss overlays
    await dismissOverlays(page);
    
    // Wait for hotel cards
    console.log('[SCRAPER] Waiting for hotel listings...');
    try {
      await page.waitForSelector('[data-testid="property-card"]', { timeout: TIMING.selectorTimeout });
      console.log('[SCRAPER] Hotel cards detected');
    } catch (e) {
      console.log('[SCRAPER] No hotel cards found');
      return [];
    }
    
    // Scroll to load lazy content
    console.log('[SCRAPER] Scrolling to load content...');
    await autoScroll(page, TIMING.scrollIterations, TIMING.scrollPause);
    await randomDelay(2000, 3000);
    
    // Extract hotel data
    console.log('[SCRAPER] Extracting hotel data...');
    const hotels = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('[data-testid="property-card"]');
      
      cards.forEach((card) => {
        try {
          const titleEl = card.querySelector('[data-testid="title"]');
          const name = titleEl ? titleEl.textContent.trim() : null;
          
          let link = null;
          const titleLink = card.querySelector('[data-testid="title-link"]');
          if (titleLink) link = titleLink.href;
          if (!link) {
            const anyLink = card.querySelector('a[href*="/hotel/"]');
            if (anyLink) link = anyLink.href;
          }
          
          let pictureUrl = null;
          const imageContainer = card.querySelector('[data-testid="image"]');
          if (imageContainer) {
            const img = imageContainer.querySelector('img');
            if (img) pictureUrl = img.src || img.getAttribute('data-src');
          }
          if (!pictureUrl) {
            const anyImg = card.querySelector('img');
            if (anyImg) pictureUrl = anyImg.src;
          }
          
          let rating = null;
          let reviewsCount = null;
          const reviewScore = card.querySelector('[data-testid="review-score"]');
          if (reviewScore) {
            const text = reviewScore.textContent;
            const ratingMatch = text.match(/(\d+\.?\d*)/);
            if (ratingMatch) rating = parseFloat(ratingMatch[1]);
            const reviewsMatch = text.match(/(\d[\d,]*)\s*review/i);
            if (reviewsMatch) reviewsCount = parseInt(reviewsMatch[1].replace(/,/g, ''), 10);
          }
          
          let location = null;
          const address = card.querySelector('[data-testid="address"]');
          if (address) location = address.textContent.trim();
          const distance = card.querySelector('[data-testid="distance"]');
          if (distance) {
            const distText = distance.textContent.trim();
            location = location ? location + ' - ' + distText : distText;
          }
          
          let pricePerNight = null;
          const priceEl = card.querySelector('[data-testid="price-and-discounted-price"]');
          if (priceEl) {
            const priceText = priceEl.textContent;
            const priceMatch = priceText.match(/([\d,]+)/);
            if (priceMatch) pricePerNight = priceMatch[1].replace(/,/g, '');
          }
          
          if (name) {
            results.push({ name, link, picture_url: pictureUrl, rating, reviews_count: reviewsCount, location, price_per_night: pricePerNight });
          }
        } catch (e) {}
      });
      
      return results;
    });
    
    // Clean hotel URLs (remove tracking params)
    const cleanedHotels = hotels.map(hotel => ({
      ...hotel,
      link: cleanHotelUrl(hotel.link)
    }));
    
    return cleanedHotels;
  } finally {
    await browser.close();
  }
}

/**
 * Dismiss cookie/overlay dialogs
 */
async function dismissOverlays(page) {
  const overlaySelectors = [
    '[id*="cookie"] button',
    '[class*="cookie"] button',
    '[aria-label*="cookie" i] button',
    '[data-testid="accept-btn"]',
    'button[id*="accept"]',
    'button[class*="accept"]',
    '[id*="consent"] button',
    '#onetrust-accept-btn-handler'
  ];
  
  for (const selector of overlaySelectors) {
    try {
      const btn = await page.$(selector);
      if (btn) {
        await btn.click();
        await randomDelay(300, 600);
        break;
      }
    } catch (e) {}
  }
}

/**
 * Auto-scroll to load lazy content
 */
async function autoScroll(page, iterations = 5, pauseMs = 1000) {
  for (let i = 0; i < iterations; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await new Promise(r => setTimeout(r, pauseMs));
  }
}

/**
 * Main scraping function
 */
async function scrapeBookingHotels(location, options = {}) {
  const searchURL = buildSearchURL(location, options);
  
  console.log('[SCRAPER] Starting Booking.com scraper...');
  console.log('[SCRAPER] Location:', location);
  console.log('[SCRAPER] Target URL:', searchURL);
  
  const zyteApiKey = process.env.ZYTE_API_KEY;
  const useZyte = options.useZyte || (zyteApiKey && process.env.USE_ZYTE === 'true');
  
  let hotels = [];
  
  try {
    if (useZyte && zyteApiKey) {
      try {
        hotels = await scrapeWithZyte(searchURL, zyteApiKey);
      } catch (zyteError) {
        // If Zyte fails (out of credits, API error, etc.), fallback to local Puppeteer
        console.warn('[SCRAPER] Zyte API failed:', zyteError.message);
        console.log('[SCRAPER] Falling back to local Puppeteer...');
        hotels = await scrapeWithPuppeteer(searchURL);
      }
    } else {
      hotels = await scrapeWithPuppeteer(searchURL);
    }
    
    console.log(`[SCRAPER] Successfully extracted ${hotels.length} hotels`);
    
    if (hotels.length > 0) {
      console.log('[SCRAPER] Sample hotel:', JSON.stringify(hotels[0], null, 2));
    }
    
    return hotels;
  } catch (error) {
    console.error('[SCRAPER] Error:', error.message);
    throw error;
  }
}

module.exports = { scrapeBookingHotels, buildSearchURL };
