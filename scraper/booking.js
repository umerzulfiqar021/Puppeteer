/**
 * booking.js
 * 
 * Core scraper module for Booking.com hotel data extraction.
 * Uses puppeteer-extra with stealth plugin for anti-bot evasion.
 * Supports Zyte API browserHtml for production use.
 * Supports @sparticuz/chromium for serverless environments.
 * 
 * @module scraper/booking
 */

require('dotenv').config();

// Check if running in serverless environment
const isServerless = !!process.env.AWS_LAMBDA_FUNCTION_NAME || 
                     !!process.env.APPWRITE_FUNCTION_ID ||
                     !!process.env.VERCEL ||
                     !!process.env.NETLIFY;

let puppeteer;
let chromium;

if (isServerless) {
  // Use puppeteer-core with @sparticuz/chromium for serverless
  puppeteer = require('puppeteer-core');
  chromium = require('@sparticuz/chromium');
} else {
  // Use puppeteer-extra with stealth for local development
  puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
}

const { TIMING, getRandomUserAgent, randomDelay } = require('./config');

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
    group_children: String(options.children || 0),
    lang: 'en-us',
    selected_currency: options.currency || 'USD'  // Force currency to help show prices
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
      javascript: true,
      // Add geolocation to appear as real user
      geolocation: 'AE', // United Arab Emirates for Dubai searches
      // Add actions to wait for content and scroll
      actions: [
        { action: 'waitForTimeout', timeout: 5 }, // Wait 5 seconds for JS to load
        { action: 'scrollBottom' },               // Scroll to load lazy content
        { action: 'waitForTimeout', timeout: 3 }  // Wait after scroll
      ]
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
    console.log('[ZYTE] Warning: Search failed - Booking.com redirected to error page');
    return []; // Return empty to trigger Puppeteer fallback
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
      
      // Extract price - try multiple patterns
      let pricePerNight = null;
      const pricePatterns = [
        /data-testid="price-and-discounted-price"[^>]*>[^<]*?(\d[\d,\.]+)/,
        /data-testid="price"[^>]*>[^<]*?(\d[\d,\.]+)/,
        /"displayedPrice"[^}]*?"amount":(\d+)/,
        /class="[^"]*price[^"]*"[^>]*>[^\d]*(\d[\d,\.]+)/i,
        /(\d[\d,]*)\s*(?:USD|EUR|GBP|AED|INR|\$|€|£)/,
        /(?:USD|EUR|GBP|AED|INR|\$|€|£)\s*(\d[\d,]*)/
      ];
      for (const pattern of pricePatterns) {
        const match = cardHtml.match(pattern);
        if (match) {
          pricePerNight = match[1].replace(/,/g, '');
          break;
        }
      }
      
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
  console.log('[SCRAPER] Serverless mode:', isServerless);
  
  const userAgent = getRandomUserAgent();
  console.log('[SCRAPER] User-Agent:', userAgent.substring(0, 50) + '...');
  
  let browser;
  
  if (isServerless) {
    // Serverless: use @sparticuz/chromium
    console.log('[SCRAPER] Launching serverless Chromium...');
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  } else {
    // Local: use regular puppeteer
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled',
        '--lang=en-US'
      ]
    });
  }
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    
    // Set cookies to appear as returning visitor
    await page.setCookie({
      name: 'pcm_personalization_disabled',
      value: '0',
      domain: '.booking.com'
    }, {
      name: 'bkng_sso_session',
      value: 'e30',
      domain: '.booking.com'  
    }, {
      name: 'cors_js',
      value: '1',
      domain: '.booking.com'
    });
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
    
    // Try to wait for prices to load (they may be loaded after scroll)
    try {
      await page.waitForSelector('[data-testid="price-and-discounted-price"], [data-testid="price"]', { timeout: 5000 });
      console.log('[SCRAPER] Price elements detected');
    } catch (e) {
      console.log('[SCRAPER] No price elements found - prices may show as "Show prices" button');
    }
    
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
          let currency = null;
          // Try multiple selectors for price - Booking.com uses various patterns
          const priceSelectors = [
            '[data-testid="price-and-discounted-price"]',
            '[data-testid="price"]',
            '[data-testid="recommended-units"] [data-testid="price-and-discounted-price"]',
            '.f6431b446c', // Booking.com price class
            '.fbd1d3018c', // Another price class
            '.fcab3ed991 .f6431b446c', // Container > price
            '[class*="priceDisplay"]',
            '[class*="price-primary"]'
          ];
          for (const selector of priceSelectors) {
            const priceEl = card.querySelector(selector);
            if (priceEl) {
              const priceText = priceEl.textContent;
              // Match currency + number or number + currency
              const priceMatch = priceText.match(/(?:[A-Z]{3}|[$€£¥])\s*(\d[\d,\.]+)|(\d[\d,\.]+)\s*(?:[A-Z]{3}|[$€£¥])/);
              if (priceMatch) {
                pricePerNight = (priceMatch[1] || priceMatch[2]).replace(/,/g, '');
                // Try to get currency
                const currMatch = priceText.match(/([A-Z]{3}|[$€£¥])/);
                if (currMatch) currency = currMatch[1];
                break;
              }
              // Fallback: just find any number
              const numMatch = priceText.match(/(\d[\d,\.]+)/);
              if (numMatch) {
                pricePerNight = numMatch[1].replace(/,/g, '');
                break;
              }
            }
          }
          
          if (name) {
            results.push({ 
              name, 
              link, 
              picture_url: pictureUrl, 
              rating, 
              reviews_count: reviewsCount, 
              location, 
              price_per_night: pricePerNight,
              currency: currency
            });
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
        
        // If Zyte returned 0 hotels (redirect/search failed), fallback to Puppeteer
        if (hotels.length === 0) {
          console.log('[SCRAPER] Zyte returned 0 hotels, falling back to Puppeteer...');
          hotels = await scrapeWithPuppeteer(searchURL);
        }
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

/**
 * Extract detailed hotel info from HTML
 */
function extractHotelDetailsFromHTML(html) {
  const details = {};
  
  try {
    // Hotel name - prioritize most reliable sources first
    // 1. og:title meta tag (most reliable, format: "★★★★★ Hotel Name, City, Country")
    const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ||
                        html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i);
    // 2. Specific hotel name from JSON with "Hotel" type
    const hotelJsonMatch = html.match(/"@type"\s*:\s*"Hotel"[^}]*?"name"\s*:\s*"([^"]+)"/i);
    // 3. data-testid for header
    const hotelNameMatch = html.match(/data-testid="header-hotel-name"[^>]*>([^<]+)</i);
    // 4. h2 header
    const h2HotelMatch = html.match(/<h2[^>]*class="[^"]*pp-header__title[^"]*"[^>]*>([^<]+)</i);
    // 5. Title tag
    const titleMatch = html.match(/<title>([^<|]+)/i);
    
    if (ogTitleMatch) {
      // Clean og:title: remove stars (★) and extract hotel name
      let name = ogTitleMatch[1].trim();
      name = name.replace(/^[★☆\s]+/, ''); // Remove leading stars
      name = name.split(',')[0].trim(); // Take first part (hotel name)
      if (name.length > 3) {
        details.name = decodeHtmlEntities(name);
      }
    }
    
    if (!details.name && hotelJsonMatch) {
      const name = hotelJsonMatch[1].trim();
      // Avoid calendar/month names
      if (name.length > 3 && !/^(January|February|March|April|May|June|July|August|September|October|November|December)$/i.test(name)) {
        details.name = decodeHtmlEntities(name);
      }
    }
    
    if (!details.name && hotelNameMatch) {
      details.name = decodeHtmlEntities(hotelNameMatch[1].trim());
    } else if (!details.name && h2HotelMatch) {
      details.name = decodeHtmlEntities(h2HotelMatch[1].trim());
    } else if (!details.name && titleMatch) {
      details.name = decodeHtmlEntities(titleMatch[1].trim());
    }
    
    // Address - from JSON-LD or HTML
    const addressJsonMatch = html.match(/"address"\s*:\s*\{[^}]*"streetAddress"\s*:\s*"([^"]+)"/i);
    const addressHtmlMatch = html.match(/data-node_tt_id="location_score_tooltip"[^>]*>([^<]+)</i) ||
                            html.match(/<span[^>]*class="[^"]*hp_address_subtitle[^"]*"[^>]*>([^<]+)</i);
    details.address = addressJsonMatch ? decodeHtmlEntities(addressJsonMatch[1]) : 
                      addressHtmlMatch ? decodeHtmlEntities(addressHtmlMatch[1].trim()) : null;
    
    // Rating score - from JSON or data attributes
    const ratingJsonMatch = html.match(/"ratingValue"\s*:\s*"?(\d+\.?\d*)"?/i);
    const ratingHtmlMatch = html.match(/aria-label="Scored\s+(\d+\.?\d*)/i) ||
                           html.match(/data-testid="review-score-right-component"[^>]*>[\s\S]*?(\d+\.?\d*)/);
    details.rating = ratingJsonMatch ? parseFloat(ratingJsonMatch[1]) : 
                    ratingHtmlMatch ? parseFloat(ratingHtmlMatch[1]) : null;
    
    // Total reviews
    const reviewsJsonMatch = html.match(/"reviewCount"\s*:\s*"?(\d+)"?/i);
    const reviewsHtmlMatch = html.match(/(\d[\d,]*)\s*reviews?/i);
    details.reviews_count = reviewsJsonMatch ? parseInt(reviewsJsonMatch[1], 10) : 
                           reviewsHtmlMatch ? parseInt(reviewsHtmlMatch[1].replace(/,/g, ''), 10) : null;
    
    // Rating text
    const ratingTextMatch = html.match(/Scored\s+[\d.]+[^>]*>[\s\S]*?<div[^>]*>([A-Za-z\s]+)</i) ||
                           html.match(/"ratingValue"[^}]*"description"\s*:\s*"([^"]+)"/i);
    details.rating_text = ratingTextMatch ? ratingTextMatch[1].trim() : null;
    
    // Description
    const descMatch = html.match(/"description"\s*:\s*"([^"]{50,1000})"/i) ||
                     html.match(/data-testid="property-description"[^>]*>([\s\S]*?)<\/div>/i);
    if (descMatch) {
      let desc = descMatch[1];
      desc = desc.replace(/<[^>]+>/g, ' ').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
      details.description = decodeHtmlEntities(desc);
    }
    
    // Main photo - from JSON-LD or HTML
    const mainPhotoJsonMatch = html.match(/"image"\s*:\s*"(https:\/\/[^"]+bstatic\.com[^"]+)"/i);
    const mainPhotoHtmlMatch = html.match(/class="[^"]*gallery-tile[^"]*"[\s\S]*?src="([^"]+bstatic\.com[^"]+)"/i) ||
                              html.match(/data-testid="destination-header-image"[\s\S]*?src="([^"]+)"/i);
    details.main_photo = mainPhotoJsonMatch ? decodeHtmlEntities(mainPhotoJsonMatch[1]) :
                        mainPhotoHtmlMatch ? decodeHtmlEntities(mainPhotoHtmlMatch[1]) : null;
    
    // All photos - unique list
    const photos = [];
    const photoRegex = /src="(https:\/\/cf\.bstatic\.com\/xdata\/images\/hotel\/[^"]+)"/gi;
    let photoMatch;
    while ((photoMatch = photoRegex.exec(html)) !== null && photos.length < 15) {
      const url = decodeHtmlEntities(photoMatch[1].split('?')[0]); // Clean URL
      if (!photos.includes(url)) photos.push(url);
    }
    details.photos = photos;
    
    // Facilities - look for specific facility section
    const facilities = [];
    
    // Method 1: From JSON-LD amenityFeature (most reliable)
    const amenitiesJsonMatch = html.match(/"amenityFeature"\s*:\s*\[([\s\S]*?)\]/i);
    if (amenitiesJsonMatch) {
      const nameRegex = /"name"\s*:\s*"([^"]+)"/gi;
      let nameMatch;
      while ((nameMatch = nameRegex.exec(amenitiesJsonMatch[1])) !== null) {
        const facility = decodeHtmlEntities(nameMatch[1]);
        if (!facilities.includes(facility)) facilities.push(facility);
      }
    }
    
    // Method 2: Popular facilities from HP important facilities
    if (facilities.length === 0) {
      const importantMatch = html.match(/hp_desc_important_facilities[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i);
      if (importantMatch) {
        const liRegex = /<li[^>]*>([^<]+)</gi;
        let liMatch;
        while ((liMatch = liRegex.exec(importantMatch[1])) !== null) {
          const f = decodeHtmlEntities(liMatch[1].trim());
          if (f && f.length > 2 && !facilities.includes(f)) facilities.push(f);
        }
      }
    }
    
    // Method 3: Facility icons text
    if (facilities.length === 0) {
      const facilityIconsRegex = /class="[^"]*hp-summary[^"]*"[\s\S]*?>([\s\S]*?)<\/div>/gi;
      let iconMatch;
      while ((iconMatch = facilityIconsRegex.exec(html)) !== null && facilities.length < 20) {
        const text = iconMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const words = text.split(/\s{2,}/);
        for (const w of words) {
          if (w.length > 3 && w.length < 30 && !/sign in|log in|^\d+$/i.test(w) && !facilities.includes(w)) {
            facilities.push(w);
          }
        }
      }
    }
    
    // Method 4: Try extracting common known facilities from text
    const knownFacilities = ['Free WiFi', 'WiFi', 'Pool', 'Swimming pool', 'Gym', 'Fitness center', 
      'Spa', 'Restaurant', 'Bar', 'Room service', 'Parking', 'Free parking', 'Air conditioning',
      'Airport shuttle', 'Beach', 'Breakfast', 'Pet friendly', '24-hour front desk', 'Non-smoking rooms',
      'Family rooms', 'Terrace', 'Garden', 'Hot tub', 'Sauna', 'Laundry', 'Kitchen', 'Balcony'];
    
    for (const fac of knownFacilities) {
      if (html.includes(fac) && !facilities.includes(fac)) {
        facilities.push(fac);
      }
    }
    
    details.facilities = facilities.slice(0, 25); // Limit to 25
    
    // Room types - multiple extraction methods
    const rooms = [];
    const seenRooms = new Set();
    
    // Method 1: From room table links
    const roomNameRegex = /hprt-roomtype-link[^>]*>[\s\S]*?<span[^>]*>([^<]+)</gi;
    let roomMatch;
    while ((roomMatch = roomNameRegex.exec(html)) !== null && rooms.length < 10) {
      const roomName = decodeHtmlEntities(roomMatch[1].trim());
      if (roomName && roomName.length > 3 && !seenRooms.has(roomName)) {
        seenRooms.add(roomName);
        rooms.push({ name: roomName, price: null, currency: null });
      }
    }
    
    // Method 2: From room blocks with data-block-id
    if (rooms.length === 0) {
      const blockRegex = /data-block-id[^>]*>[\s\S]*?<a[^>]*>[\s\S]*?<span[^>]*>([^<]{5,60})<\/span>/gi;
      let blockMatch;
      while ((blockMatch = blockRegex.exec(html)) !== null && rooms.length < 10) {
        const roomName = decodeHtmlEntities(blockMatch[1].trim());
        if (roomName && !seenRooms.has(roomName) && !/\d+\s*nights?/i.test(roomName)) {
          seenRooms.add(roomName);
          rooms.push({ name: roomName, price: null, currency: null });
        }
      }
    }
    
    // Get prices - look for price per night
    const priceRegex = /(?:AED|USD|EUR|GBP|INR)\s*([\d,]+)/gi;
    let priceMatch2;
    const prices = [];
    while ((priceMatch2 = priceRegex.exec(html)) !== null && prices.length < 10) {
      const currencyMatch = priceMatch2[0].match(/[A-Z]+/);
      if (currencyMatch) {
        prices.push({
          currency: currencyMatch[0],
          amount: priceMatch2[1].replace(/,/g, '')
        });
      }
    }
    
    // Assign prices to rooms
    for (let i = 0; i < rooms.length && i < prices.length; i++) {
      rooms[i].currency = prices[i].currency;
      rooms[i].price = prices[i].amount;
    }
    
    details.rooms = rooms;
    
    // Check-in / Check-out times - more specific pattern
    const checkinMatch = html.match(/Check-in<\/div>[\s\S]*?From\s*(\d{1,2}:\d{2})/i) ||
                        html.match(/check-in[^>]*>[\s\S]*?(\d{1,2}:\d{2})\s*[–-]/i);
    const checkoutMatch = html.match(/Check-out<\/div>[\s\S]*?Until\s*(\d{1,2}:\d{2})/i) ||
                         html.match(/check-out[^>]*>[\s\S]*?until\s*(\d{1,2}:\d{2})/i);
    details.checkin_time = checkinMatch ? checkinMatch[1] : null;
    details.checkout_time = checkoutMatch ? checkoutMatch[1] : null;
    
    // Coordinates from JSON or data attributes
    const coordsJsonMatch = html.match(/"geo"\s*:\s*\{[^}]*"latitude"\s*:\s*(-?\d+\.?\d*)[^}]*"longitude"\s*:\s*(-?\d+\.?\d*)/i) ||
                           html.match(/"latitude"\s*:\s*(-?\d+\.?\d*)[\s\S]*?"longitude"\s*:\s*(-?\d+\.?\d*)/i);
    const latAttrMatch = html.match(/data-lat="(-?\d+\.?\d*)"/i);
    const lngAttrMatch = html.match(/data-lng="(-?\d+\.?\d*)"/i);
    
    details.coordinates = {
      latitude: coordsJsonMatch ? parseFloat(coordsJsonMatch[1]) : latAttrMatch ? parseFloat(latAttrMatch[1]) : null,
      longitude: coordsJsonMatch ? parseFloat(coordsJsonMatch[2]) : lngAttrMatch ? parseFloat(lngAttrMatch[1]) : null
    };
    
    // Property highlights/features
    const highlights = [];
    const highlightMatch = html.match(/Property Highlights[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i);
    if (highlightMatch) {
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch;
      while ((liMatch = liRegex.exec(highlightMatch[1])) !== null) {
        const text = decodeHtmlEntities(liMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        if (text && text.length > 3) highlights.push(text);
      }
    }
    details.highlights = highlights;
    
    // Star rating
    const starsMatch = html.match(/data-testid="rating-stars"[^>]*>[\s\S]*?(\d)\s*star/i) ||
                      html.match(/"starRating"\s*:\s*\{[^}]*"ratingValue"\s*:\s*(\d)/i);
    details.stars = starsMatch ? parseInt(starsMatch[1], 10) : null;
    
    // ===== AREA INFO / NEARBY PLACES - DYNAMIC EXTRACTION =====
    const areaInfo = {};
    
    try {
      // Helper to convert category name to key
      const categoryToKey = (cat) => {
        return cat.toLowerCase()
          .replace(/&amp;/g, 'and')
          .replace(/&/g, 'and')
          .replace(/[''"]/g, '')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');
      };
      
      // Find ALL category blocks dynamically
      // Structure: <div class="e7addce19e...">CATEGORY</div></h3></div><ul...data-testid="poi-block-list"...>ITEMS</ul>
      const categoryBlockPattern = /<div class="e7addce19e[^"]*">([^<]+)<\/div><\/h3><\/div><ul[^>]*data-testid="poi-block-list"[^>]*>([\s\S]*?)<\/ul>/gi;
      let categoryMatch;
      
      while ((categoryMatch = categoryBlockPattern.exec(html)) !== null) {
        const categoryName = decodeHtmlEntities(categoryMatch[1].trim());
        const categoryKey = categoryToKey(categoryName);
        const itemsHtml = categoryMatch[2];
        
        if (!categoryKey || categoryKey.length < 2) continue;
        
        const items = [];
        
        // Extract all items from this category block
        // Item structure: class="aa225776f2...">NAME or <span>TYPE</span>NAME</div>...<div class="b99b6ef58f...">DISTANCE</div>
        const itemPattern = /class="aa225776f2[^"]*">((?:<span[^>]*>([^<]+)<\/span>)?([^<]*))<\/div>[\s\S]*?class="b99b6ef58f[^"]*">(\d+\.?\d*)\s*(km|m)<\/div>/gi;
        let itemMatch;
        
        while ((itemMatch = itemPattern.exec(itemsHtml)) !== null && items.length < 15) {
          const type = itemMatch[2] ? itemMatch[2].trim() : null;  // Type from <span> (Restaurant, Train, etc.)
          const name = decodeHtmlEntities(itemMatch[3].trim());     // Name after span or full name
          const distance = itemMatch[4] + ' ' + itemMatch[5];
          
          if (name.length > 1) {
            if (type) {
              items.push({ type, name, distance });
            } else {
              items.push({ name, distance });
            }
          }
        }
        
        if (items.length > 0) {
          areaInfo[categoryKey] = items;
        }
      }
      
      // Airports from JSON (always available even when HTML lazy-loaded content missing)
      // Pattern: "title":"Airport Name","subtitle":"(CODE) X km"
      if (!areaInfo.closest_airports || areaInfo.closest_airports.length === 0) {
        const airports = [];
        const airportJsonPattern = /"title":"([^"]*Airport[^"]*)","subtitle":"\(([A-Z]+)\)\s*(\d+\.?\d*)\s*(km|mi)"/gi;
        let airportMatch;
        while ((airportMatch = airportJsonPattern.exec(html)) !== null) {
          const name = decodeHtmlEntities(airportMatch[1].trim());
          const code = airportMatch[2];
          const distance = airportMatch[3] + ' ' + airportMatch[4];
          if (airports.length < 5) {
            airports.push({ name, code, distance });
          }
        }
        if (airports.length > 0) {
          areaInfo.closest_airports = airports;
        }
      }
      
      // Method 3: Fallback - extract from description if no area info found
      if (Object.keys(areaInfo).length === 0) {
        const descText = details.description || '';
        const attractions = [];
        const attractionPattern = /([A-Z][^.]*?)\s+is\s+(\d+\.?\d*)\s*(km|mi|miles?)\s+from/gi;
        let attrMatch;
        while ((attrMatch = attractionPattern.exec(descText)) !== null) {
          const name = attrMatch[1].trim();
          if (name.length > 3 && name.length < 60 && !/hotel|property|accommodation/i.test(name)) {
            attractions.push({ name, distance: attrMatch[2] + ' ' + attrMatch[3] });
          }
        }
        if (attractions.length > 0) {
          areaInfo.nearby_from_description = attractions;
        }
        
        // Airports from description
        const airportDescMatch = descText.match(/nearest airport is ([^,]+),?\s*(\d+\.?\d*)\s*(km|mi)/i);
        if (airportDescMatch) {
          areaInfo.closest_airports = [{ 
            name: airportDescMatch[1].trim(), 
            distance: airportDescMatch[2] + ' ' + airportDescMatch[3] 
          }];
        }
      }
      
      // Extract city from JSON
      const locationJsonMatch = html.match(/"location"\s*:\s*\{[^}]*"city"\s*:\s*"([^"]+)"[^}]*\}/i);
      if (locationJsonMatch) {
        details.city = locationJsonMatch[1];
      }
    } catch (areaErr) {
      console.error('[DETAILS] Area info extraction error:', areaErr.message);
    }
    
    details.area_info = areaInfo;
    
    // ===== LANGUAGES SPOKEN =====
    try {
      const languages = [];
      
      // Pattern 1: From JSON "availableLanguage" array
      const langJsonMatch = html.match(/"availableLanguage"\s*:\s*\[([^\]]+)\]/i);
      if (langJsonMatch) {
        const langRegex = /"(?:name|value)"\s*:\s*"([^"]+)"/gi;
        let langMatch;
        while ((langMatch = langRegex.exec(langJsonMatch[1])) !== null) {
          const lang = decodeHtmlEntities(langMatch[1]);
          if (!languages.includes(lang)) languages.push(lang);
        }
      }
      
      // Pattern 2: Direct string array pattern
      if (languages.length === 0) {
        const langArrayMatch = html.match(/"availableLanguage"\s*:\s*\["([^"\]]+)"\]/i);
        if (langArrayMatch) {
          langArrayMatch[1].split('","').forEach(lang => {
            const cleaned = lang.trim();
            if (cleaned && !languages.includes(cleaned)) languages.push(cleaned);
          });
        }
      }
      
      // Pattern 3: Languages spoken section in HTML
      if (languages.length === 0) {
        const langSectionMatch = html.match(/Languages?\s*[Ss]poken[\s\S]{0,200}?>(Arabic|English|Hindi|French|German|Spanish|Chinese|Russian|Japanese|Korean|Portuguese|Italian|Dutch|Turkish|Urdu)(?:[,\s]*(Arabic|English|Hindi|French|German|Spanish|Chinese|Russian|Japanese|Korean|Portuguese|Italian|Dutch|Turkish|Urdu))*</i);
        if (langSectionMatch) {
          for (let i = 1; i < langSectionMatch.length; i++) {
            if (langSectionMatch[i] && !languages.includes(langSectionMatch[i])) {
              languages.push(langSectionMatch[i]);
            }
          }
        }
      }
      
      // Pattern 4: Look for comma-separated languages in text
      if (languages.length === 0) {
        const langTextMatch = html.match(/(Arabic|English|Hindi|French|German|Spanish|Chinese|Russian)[,\s]+(Arabic|English|Hindi|French|German|Spanish|Chinese|Russian)(?:[,\s]+(Arabic|English|Hindi|French|German|Spanish|Chinese|Russian))?/i);
        if (langTextMatch) {
          for (let i = 1; i < langTextMatch.length; i++) {
            if (langTextMatch[i] && !languages.includes(langTextMatch[i])) {
              languages.push(langTextMatch[i]);
            }
          }
        }
      }
      
      if (languages.length > 0) {
        details.languages_spoken = languages;
      }
    } catch (langErr) {
      console.error('[DETAILS] Languages extraction error:', langErr.message);
    }
    
    // ===== NEIGHBORHOOD / COMPANY INFO =====
    try {
      const propertyInfo = {};
      
      // Pattern 1: Host profile with company/neighborhood info
      // Look for data-testid="TextListItem" patterns which often contain this info
      const hostProfileMatch = html.match(/data-testid="TextListItem"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi);
      if (hostProfileMatch) {
        hostProfileMatch.forEach(match => {
          const labelMatch = match.match(/<span[^>]*>([^<]+)<\/span>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
          if (labelMatch) {
            const label = labelMatch[1].trim().toLowerCase();
            const value = decodeHtmlEntities(labelMatch[2].trim());
            if (label.includes('company') || label.includes('host')) {
              propertyInfo.company_info = value;
            } else if (label.includes('neighborhood') || label.includes('neighbourhood') || label.includes('area')) {
              propertyInfo.neighborhood = value;
            } else if (label.includes('language')) {
              // Also capture languages from here if not already captured
              if (!details.languages_spoken) {
                details.languages_spoken = value.split(/[,،]/).map(l => l.trim()).filter(l => l.length > 1);
              }
            }
          }
        });
      }
      
      // Pattern 2: Property description block
      const propDescBlock = html.match(/data-testid="property-description"[^>]*>([\s\S]*?)<\/div>/i);
      if (propDescBlock) {
        const text = propDescBlock[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 50 && text.length < 1000) {
          propertyInfo.description = decodeHtmlEntities(text);
        }
      }
      
      // Pattern 3: About the host section
      const aboutHostMatch = html.match(/About\s+(?:the\s+)?(?:host|property|hotel)[\s\S]*?<(?:p|div)[^>]*>([^<]{30,500})</i);
      if (aboutHostMatch) {
        propertyInfo.about = decodeHtmlEntities(aboutHostMatch[1].trim());
      }
      
      // Pattern 4: Check-in info / house rules section often contains useful info
      const houseRulesMatch = html.match(/House\s+[Rr]ules[\s\S]*?<(?:p|div)[^>]*>([^<]{20,300})</i);
      if (houseRulesMatch) {
        propertyInfo.house_rules = decodeHtmlEntities(houseRulesMatch[1].trim());
      }
      
      if (Object.keys(propertyInfo).length > 0) {
        details.property_info = propertyInfo;
      }
    } catch (propErr) {
      console.error('[DETAILS] Property info extraction error:', propErr.message);
    }
    
  } catch (e) {
    console.error('[DETAILS] Extraction error:', e.message);
  }
  
  return details;
}

/**
 * Scrape hotel details using Zyte API
 */
async function scrapeHotelDetailsWithZyte(hotelURL, zyteApiKey) {
  console.log('[ZYTE] Fetching hotel details...');
  console.log('[ZYTE] URL:', hotelURL);
  
  const response = await fetch('https://api.zyte.com/v1/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(zyteApiKey + ':').toString('base64')
    },
    body: JSON.stringify({
      url: hotelURL,
      browserHtml: true,
      javascript: true
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Zyte API error: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  console.log('[ZYTE] Received hotel page HTML, length:', data.browserHtml?.length || 0);
  
  return extractHotelDetailsFromHTML(data.browserHtml);
}

/**
 * Scrape hotel details using local Puppeteer
 */
async function scrapeHotelDetailsWithPuppeteer(hotelURL) {
  console.log('[SCRAPER] Fetching hotel details with Puppeteer...');
  console.log('[SCRAPER] Serverless mode:', isServerless);
  
  const userAgent = getRandomUserAgent();
  let browser;
  
  if (isServerless) {
    // Serverless: use @sparticuz/chromium
    console.log('[SCRAPER] Launching serverless Chromium...');
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  } else {
    // Local: use regular puppeteer
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled'
      ]
    });
  }
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });
    
    await randomDelay(500, 1500);
    await page.goto(hotelURL, { waitUntil: 'networkidle2', timeout: TIMING.navigationTimeout });
    
    // Wait for body to exist
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Additional wait for content to load
    await randomDelay(1000, 1500);
    
    // Dismiss overlays
    await dismissOverlays(page);
    
    // Scroll to trigger lazy loading - scroll to bottom where area info is
    await page.evaluate(async () => {
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      const h = document.body?.scrollHeight || 5000;
      
      // Scroll down in steps to trigger ALL lazy content
      for (let i = 1; i <= 6; i++) {
        window.scrollTo(0, (h / 6) * i);
        await delay(400);
      }
      
      // Try to click on "Location" section if visible
      const locationTab = document.querySelector('[data-testid="property-section-location"]') ||
                          document.querySelector('#surroundings_block') ||
                          document.querySelector('[data-section-name="Location"]');
      if (locationTab) {
        locationTab.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(1000);
      }
      
      // Scroll back to top
      window.scrollTo(0, 0);
      await delay(500);
      
      // Scroll to bottom again
      window.scrollTo(0, h);
      await delay(1000);
    });
    
    // Wait for POI blocks to appear
    try {
      await page.waitForSelector('[data-testid="poi-block-list"]', { timeout: 8000 });
    } catch (e) {
      // POI block not found, try waiting for location section
      try {
        await page.waitForSelector('[data-testid="PropertySurroundingsBlock"]', { timeout: 3000 });
      } catch (e2) {
        // Continue anyway
      }
    }
    
    await randomDelay(500, 1000);
    
    const html = await page.content();
    
    return extractHotelDetailsFromHTML(html);
    
  } finally {
    await browser.close();
  }
}

/**
 * Main function to scrape hotel details from a specific hotel URL
 */
async function scrapeHotelDetails(hotelURL, options = {}) {
  console.log('[SCRAPER] Starting hotel details scraper...');
  console.log('[SCRAPER] Hotel URL:', hotelURL);
  
  const zyteApiKey = process.env.ZYTE_API_KEY;
  const useZyte = options.useZyte || (zyteApiKey && process.env.USE_ZYTE === 'true');
  
  try {
    let details;
    
    if (useZyte && zyteApiKey) {
      try {
        details = await scrapeHotelDetailsWithZyte(hotelURL, zyteApiKey);
      } catch (zyteError) {
        console.warn('[SCRAPER] Zyte API failed:', zyteError.message);
        console.log('[SCRAPER] Falling back to local Puppeteer...');
        details = await scrapeHotelDetailsWithPuppeteer(hotelURL);
      }
    } else {
      details = await scrapeHotelDetailsWithPuppeteer(hotelURL);
    }
    
    details.url = hotelURL;
    console.log('[SCRAPER] Hotel details extracted successfully');
    
    return details;
  } catch (error) {
    console.error('[SCRAPER] Error:', error.message);
    throw error;
  }
}

module.exports = { scrapeBookingHotels, scrapeHotelDetails, buildSearchURL };
