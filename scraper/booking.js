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

// Helper for simple delays
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    selected_currency: options.currency || 'USD',
    // Add common organic parameters to mimic real traffic
    aid: '304142',
    label: 'gen173bo-1DCAEoggI46AdIM1gDaGiIAQGYATG4ARfIAQzYAQHoAQGIAgGoAgO4AsmNrr0GwAIB0gIkYWI1NmZlYmEtNTA4Yy00ZjIyLWIzOTItYTRkMjYyZDVlMTU52AIE4AIB'
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
  
  const debugInfo = {
     url: data.url,
     contentLength: data.browserHtml?.length || 0,
     title: null // Zyte doesn't easily give title unless parsed from HTML
  };
  
  return { hotels, debugInfo };
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
  
  // Check for Browserless.io token (cloud browser service)
  const browserlessToken = process.env.BROWSERLESS_TOKEN;
  
  if (browserlessToken) {
    // Use Browserless.io cloud browser
    console.log('[SCRAPER] Using Browserless.io cloud browser...');
    const puppeteerCore = require('puppeteer-core');
    browser = await puppeteerCore.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${browserlessToken}`,
    });
  } else if (isServerless) {
    // Serverless: use @sparticuz/chromium
    console.log('[SCRAPER] Launching serverless Chromium...');
    const execPath = await chromium.executablePath();
    console.log('[SCRAPER] Chromium path:', execPath);
    
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
      ],
      defaultViewport: { width: 1920, height: 1080 },
      executablePath: execPath,
      headless: true,
      ignoreHTTPSErrors: true,
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
    
    // Redirect browser console logs
    page.on('console', msg => {
      console.log(`[BROWSER-SEARCH] ${msg.text()}`);
    });
    
    // Skip viewport for serverless (use default)
    if (!isServerless) {
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    }
    
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
    
    // Enable request interception to block unnecessary resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      const url = req.url();
      
      // Block images, fonts, media, and third-party scripts (keep stylesheets for layout)
      if (['image', 'font', 'media'].includes(resourceType) || 
          url.includes('google-analytics') || 
          url.includes('doubleclick') || 
          url.includes('facebook')) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    console.log('[SCRAPER] Navigating to search URL...');
    console.log('[SCRAPER] URL:', searchURL);
    
    // Use load for serverless to ensure page is ready
    try {
      await page.goto(searchURL, { waitUntil: 'networkidle2', timeout: 60000 });
      console.log('[SCRAPER] Page loaded');
    } catch (navError) {
      console.log('[SCRAPER] Navigation error:', navError.message);
      // Try to continue anyway - page might have partial content
    }
    
    // Wait for network to settle
    await randomDelay(2500, 4500);
    
    // Check if page has content
    const pageContent = await page.content();
    console.log('[SCRAPER] Page content length:', pageContent.length);
    
    // Save debug info
    const title = await page.title();
    console.log('[SCRAPER] Page title:', title);
    
    if (pageContent.length < 5000 || title.includes('Access Denied')) {
      console.log('[SCRAPER] Page seems empty, blocked, or access denied');
    }
    
    // Dismiss overlays
    await dismissOverlays(page);
    
    // Wait for content to settle
    await randomDelay(2000, 4000);
    
    // Wait for hotel cards with longer timeout for serverless
    console.log('[SCRAPER] Waiting for hotel listings...');
    const cardSelectors = [
      '[data-testid="property-card"]',
      '.sr_property_block',
      '[data-hotelid]',
      '.hotel_name_link',
      '.c-sr-hotel-card'
    ];
    
    let foundSelector = null;
    for (const selector of cardSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        console.log(`[SCRAPER] Hotel cards detected with selector: ${selector}`);
        foundSelector = selector;
        break;
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (!foundSelector) {
      console.log('[SCRAPER] No hotel elements found with any selector');
      
      const finalUrl = page.url();
      const isBlocked = pageContent.toLowerCase().includes('robot') || 
                        pageContent.toLowerCase().includes('captcha') ||
                        title.includes('Access Denied') ||
                        (finalUrl.includes('index.html') && finalUrl.includes('errorc_searchstring'));
      
      return { 
        hotels: [], 
        debugInfo: { 
          title, 
          contentLength: pageContent.length, 
          finalUrl: finalUrl,
          isBlocked,
          error: isBlocked ? 'Rate limited or blocked by Booking.com' : 'No hotel elements found after trying all selectors'
        } 
      };
    }
    
    // Scroll to load lazy content
    console.log('[SCRAPER] Scrolling to load content...');
    await autoScroll(page, TIMING.scrollIterations, TIMING.scrollPause);
    await randomDelay(1500, 2500);
    
    // Proactive overlay dismissal after scroll
    await dismissOverlays(page);
    
    // Try to wait for prices to load (they may be loaded after scroll)
    try {
      await page.waitForSelector('[data-testid="price-and-discounted-price"], [data-testid="price"]', { timeout: 5000 });
      console.log('[SCRAPER] Price elements detected');
    } catch (e) {
      console.log('[SCRAPER] No price elements found - prices may show as "Show prices" button');
    }
    
    // Extract hotel data
    console.log('[SCRAPER] Extracting hotel data...');
    const hotels = await page.evaluate((selector) => {
      const results = [];
      const cards = document.querySelectorAll(selector);
      
      cards.forEach((card, i) => {
        if (i >= 25) return;
        try {
          const cardText = card.innerText;
          if (i === 0) console.log(`[DEBUG] Hotel 1 cardText: ${cardText.substring(0, 1000)}`);
          
          const nameEl = card.querySelector('[data-testid="title"]') || card.querySelector('.sr-hotel__name') || card.querySelector('h3');
          if (!nameEl) return;
          const name = nameEl.textContent.trim();
          
          let rating = null;
          let reviewsCount = null;
          
          // Pattern: "Scored 7.8", "7.8", "Good", "269 reviews"
          const rMatch = cardText.match(/Scored\s+(\d+\.?\d*)/i) || 
                         cardText.match(/(\d+\.\d)/);
          if (rMatch) rating = parseFloat(rMatch[1]);
          
          const cMatch = cardText.match(/(\d[\d,]*)\s*(?:verified\s*)?reviews?/i);
          if (cMatch) reviewsCount = parseInt(cMatch[1].replace(/,/g, ''), 10);
          
          const locationMatch = cardText.match(/([^\n]+)Show on map/i) || cardText.match(/(\d+\.?\d* km from downtown)/i);
          const location = locationMatch ? locationMatch[1].trim() : (card.querySelector('[data-testid="address"]')?.textContent.trim() || null);
          
          const priceEl = card.querySelector('[data-testid="price-and-discounted-price"]') || card.querySelector('[data-testid="price"]');
          let price = null;
          if (priceEl) {
            const pMatch = priceEl.textContent.match(/(\d[\d,]*)/);
            if (pMatch) price = pMatch[1].replace(/,/g, '');
          }
          
          const linkEl = card.querySelector('[data-testid="title-link"]') || card.querySelector('a[href*="/hotel/"]');
          const link = linkEl ? linkEl.href : null;
          
          let pictureUrl = null;
          const imgEl = card.querySelector('[data-testid="image"]') || card.querySelector('img');
          if (imgEl) {
            pictureUrl = imgEl.src || imgEl.getAttribute('data-src');
          }
          
          results.push({ 
            name, 
            link,
            picture_url: pictureUrl,
            rating, 
            reviews_count: reviewsCount, 
            location, 
            price_per_night: price,
            currency: '$'
          });
        } catch (e) {
          console.error(`[EVALUATE] Error at index ${i}:`, e.message);
        }
      });
      
      return results;
    }, foundSelector);
    
    // Clean hotel URLs (remove tracking params)
    const cleanedHotels = hotels.map(hotel => ({
      ...hotel,
      link: cleanHotelUrl(hotel.link)
    }));
    
    // Collect debug info
    const debugInfo = {
      title: await page.title(),
      contentLength: pageContent.length,
      finalUrl: page.url(),
      screenshot: null 
    };
    
    return { hotels: cleanedHotels, debugInfo };
  } finally {
    await browser.close();
  }
}

/**
 * Weather Scraper - Scrapes weather data for a location
 */
async function scrapeWeather(location) {
  console.log(`[WEATHER] Scraping weather for: ${location}`);
  
  const userAgent = getRandomUserAgent();
  let browser;
  
  if (isServerless) {
    const execPath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox'],
      executablePath: execPath,
      headless: true
    });
  } else {
    browser = await puppeteer.launch({ headless: 'new' });
  }
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    
    const weatherURL = `https://www.google.com/search?q=weather+in+${encodeURIComponent(location)}`;
    await page.goto(weatherURL, { waitUntil: 'networkidle2', timeout: 30000 });
    
    const weatherData = await page.evaluate(() => {
      try {
        const temp = document.querySelector('#wob_tm')?.textContent || 
                     document.querySelector('.wob_t')?.textContent || "N/A";
        const unit = document.querySelector('#wob_u')?.textContent || "°C";
        const condition = document.querySelector('#wob_dc')?.textContent || "N/A";
        const humidity = document.querySelector('#wob_hm')?.textContent || "N/A";
        const wind = document.querySelector('#wob_ws')?.textContent || "N/A";
        const locationName = document.querySelector('#wob_loc')?.textContent || "N/A";
        
        return {
          temperature: `${temp}${unit}`,
          condition,
          humidity,
          wind,
          location: locationName
        };
      } catch (e) {
        return { error: 'Failed to parse weather data' };
      }
    });
    
    return weatherData;
  } finally {
    await browser.close();
  }
}

/**
 * Shared Helpers
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
    '#onetrust-accept-btn-handler',
    'button[aria-label="Dismiss"]',
    '[data-testid="selection-item-close"]'
  ];
  
  for (const selector of overlaySelectors) {
    try {
      const btn = await page.$(selector);
      if (btn) {
        await btn.click();
        await randomDelay(300, 600);
      }
    } catch (e) {}
  }
}

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
  console.log('[SCRAPER] Environment: ', isServerless ? 'SERVERLESS' : 'LOCAL');
  
  const zyteApiKey = process.env.ZYTE_API_KEY;
  const browserlessToken = process.env.BROWSERLESS_TOKEN;
  const useZyte = options.useZyte || (zyteApiKey && process.env.USE_ZYTE === 'true');
  
  let hotels = [];
  let debugInfo = {};
  
  try {
    // Priority 1: Use Zyte API if configured
    if (useZyte && zyteApiKey) {
      try {
        console.log('[SCRAPER] Using Zyte API...');
        const result = await scrapeWithZyte(searchURL, zyteApiKey);
        hotels = result.hotels;
        debugInfo = result.debugInfo;
        
        if (hotels.length === 0 && !isServerless) {
          console.log('[SCRAPER] Zyte returned 0 hotels, falling back to Puppeteer...');
          const fallbackResult = await scrapeWithPuppeteer(searchURL);
          hotels = fallbackResult.hotels;
          debugInfo = fallbackResult.debugInfo;
        }
      } catch (zyteError) {
        console.warn('[SCRAPER] Zyte API failed:', zyteError.message);
        if (!isServerless) {
          console.log('[SCRAPER] Falling back to local Puppeteer...');
          const fallbackResult = await scrapeWithPuppeteer(searchURL);
          hotels = fallbackResult.hotels;
          debugInfo = fallbackResult.debugInfo;
        } else {
          throw new Error('Zyte API failed and no fallback available in serverless: ' + zyteError.message);
        }
      }
    }
    // Priority 2: Try local Puppeteer
    else if (!isServerless || browserlessToken) {
      console.log(browserlessToken ? '[SCRAPER] Using Browserless.io...' : '[SCRAPER] Using local Puppeteer...');
      const result = await scrapeWithPuppeteer(searchURL);
      hotels = result.hotels;
      debugInfo = result.debugInfo;
      
      // FAIL-SAFE: If Puppeteer returns 0 hotels or is blocked, AND ZYTE key exists, retry with Zyte
      if (hotels.length === 0 && zyteApiKey && !options.noRetry) {
        console.log('[SCRAPER] Puppeteer failed or blocked. Automatic FAIL-SAFE retry with Zyte API...');
        try {
          const zyteResult = await scrapeWithZyte(searchURL, zyteApiKey);
          if (zyteResult.hotels && zyteResult.hotels.length > 0) {
            hotels = zyteResult.hotels;
            debugInfo = { ...zyteResult.debugInfo, was_fallback: true, original_debug: debugInfo };
            console.log(`[SCRAPER] Fail-safe success: Extracted ${hotels.length} hotels via Zyte`);
          }
        } catch (e) {
          console.warn('[SCRAPER] Fail-safe Zyte retry also failed:', e.message);
        }
      }
    }
    // No scraping method available in serverless
    else {
      throw new Error(
        'No scraping service configured for serverless environment. ' +
        'Please set ZYTE_API_KEY or BROWSERLESS_TOKEN environment variable in Appwrite Console.'
      );
    }
    
    console.log(`[SCRAPER] Successfully extracted ${hotels.length} hotels`);
    
    if (hotels.length > 0) {
      console.log('[SCRAPER] Sample hotel:', JSON.stringify(hotels[0], null, 2));
    }
    
    // Attach debug info to the result
    return { hotels, debugInfo: { method: useZyte ? 'zyte' : 'puppeteer', url: searchURL, count: hotels.length, ...debugInfo } };
  } catch (error) {
    console.error('[SCRAPER] Error:', error.message);
    // Return debug info even on error
    return { hotels: [], debugInfo: { error: error.message, stack: error.stack, url: searchURL } };
  }
}

/**
 * Extract detailed hotel info from HTML
 */
function extractHotelDetailsFromHTML(html) {
  const details = {
    url: '',
    name: null,
    address: null,
    rating: null,
    reviews_count: null,
    rating_text: null,
    main_photo: null,
    photos: [],
    facilities: [],
    grouped_facilities: {},
    restaurants: [],
    rooms: [],
    checkin_time: null,
    checkout_time: null,
    coordinates: { latitude: null, longitude: null },
    highlights: [],
    stars: null,
    area_info: {},
    property_info: {}
  };
  
  try {
    // ===== JSON-LD EXTRACTION (Primary source for name, rating, address, city) =====
    const jsonLdBlocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdBlocks) {
      jsonLdBlocks.forEach(block => {
        try {
          const jsonText = block.replace(/<script[^>]*>|<\/script>/gi, '').trim();
          const data = JSON.parse(jsonText);
          
          const processEntity = (entity) => {
            if (entity['@type'] === 'Hotel' || entity['@type'] === 'Accommodation') {
              if (!details.name && entity.name) details.name = decodeHtmlEntities(entity.name);
              if (!details.address && entity.address?.streetAddress) details.address = decodeHtmlEntities(entity.address.streetAddress);
              if (!details.city && entity.address?.addressLocality) details.city = decodeHtmlEntities(entity.address.addressLocality);
              
              if (entity.aggregateRating) {
                if (!details.rating && entity.aggregateRating.ratingValue) details.rating = parseFloat(entity.aggregateRating.ratingValue);
                if (!details.reviews_count && entity.aggregateRating.reviewCount) details.reviews_count = parseInt(entity.aggregateRating.reviewCount, 10);
              }
              
              if (!details.description && entity.description) details.description = decodeHtmlEntities(entity.description);
              if (!details.main_photo && entity.image) details.main_photo = entity.image;
              if (entity.starRating?.ratingValue && !details.stars) details.stars = parseInt(entity.starRating.ratingValue, 10);
              
              // Coordinates from JSON-LD
              if (entity.geo && !details.coordinates.latitude) {
                details.coordinates.latitude = parseFloat(entity.geo.latitude);
                details.coordinates.longitude = parseFloat(entity.geo.longitude);
              }
            }
          };

          if (Array.isArray(data)) data.forEach(processEntity);
          else processEntity(data);
        } catch (e) {
          // Ignore parse errors for secondary scripts
        }
      });
    }
    
    // Fallback for Hotel name - prioritize most reliable sources first
    // 1. Specific hotel name from JSON with "Hotel" type
    const hotelJsonMatch = html.match(/"@type"\s*:\s*"Hotel"[^}]*?"name"\s*:\s*"([^"]+)"/i);
    if (!details.name && hotelJsonMatch) {
      details.name = decodeHtmlEntities(hotelJsonMatch[1].trim());
    }
    
    // 2. data-testid for header
    const hotelNameMatch = html.match(/data-testid="header-hotel-name"[^>]*>([^<]+)</i);
    if (!details.name && hotelNameMatch) {
      details.name = decodeHtmlEntities(hotelNameMatch[1].trim());
    }
    
    // 3. h2 header
    const h2HotelMatch = html.match(/<h2[^>]*class="[^"]*pp-header__title[^"]*"[^>]*>([^<]+)</i);
    if (!details.name && h2HotelMatch) {
      details.name = decodeHtmlEntities(h2HotelMatch[1].trim());
    }
    
    // 4. Title tag as a last resort
    const titleMatch = html.match(/<title>([^<|]+)/i);
    if (!details.name && titleMatch) {
      let name = titleMatch[1].trim();
      if (!name.toLowerCase().includes('booking.com') && !name.toLowerCase().includes('the largest selection')) {
        name = name.split(/[|,-]/)[0].trim();
        details.name = decodeHtmlEntities(name);
      }
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
    
    // Fallback: extraction from general score text in HTML
    if (!details.rating) {
      const generalRatingMatch = html.match(/class="[^"]*review-score-badge[^"]*"[^>]*>([^<]+)</i) ||
                                html.match(/data-testid="review-score-badge"[^>]*>([^<]+)</i);
      if (generalRatingMatch) details.rating = parseFloat(generalRatingMatch[1].trim());
    }
    
    // Total reviews
    const reviewsJsonMatch = html.match(/"reviewCount"\s*:\s*"?(\d+)"?/i);
    const reviewsHtmlMatch = html.match(/(\d[\d,]*)\s*reviews?/i) || html.match(/class="[^"]*review-score-badge[^"]*"[^>]*>[\s\S]*?(\d[\d,]*)\s*reviews?/i);
    details.reviews_count = reviewsJsonMatch ? parseInt(reviewsJsonMatch[1], 10) : 
                           reviewsHtmlMatch ? parseInt(reviewsHtmlMatch[1].replace(/,/g, ''), 10) : null;
    
    // Fallback: extraction from generic review text
    if (!details.reviews_count) {
      const genReviewsMatch = html.match(/(\d[\d,]*)\s*External reviews/i) ||
                             html.match(/(\d[\d,]*)\s*verified reviews/i) ||
                             html.match(/data-testid="review-score-link"[^>]*>[\s\S]*?(\d[\d,]*)/);
      if (genReviewsMatch) details.reviews_count = parseInt(genReviewsMatch[1].replace(/,/g, ''), 10);
    }
    
    // Rating text
    const ratingTextMatch = html.match(/Scored\s+[\d.]+[^>]*>[\s\S]*?<div[^>]*>([A-Za-z\s]+)</i) ||
                           html.match(/"ratingValue"[^}]*"description"\s*:\s*"([^"]+)"/i);
    details.rating_text = ratingTextMatch ? ratingTextMatch[1].trim() : null;
    
    // Description
    const descMatch = html.match(/"description"\s*:\s*"([^"]{50,2000})"/i) ||
                     html.match(/data-testid="property-description"[^>]*>([\s\S]*?)<\/div>/i) ||
                     html.match(/id="property_description_content"[^>]*>([\s\S]*?)<\/div>/i);
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
    
    // Unified Facilities Discovery (Detailed & Grouped)
    const groupedFacilities = {};
    const allFacilities = [];
    
    // Pattern: <div class="..."><div class="...">CATEGORY</div><ul class="...">...<li>FACILITY</li>...</ul></div>
    // This looks for the grouped facilities sections (Bathroom, Bedroom, Kitchen, etc.)
    const facilityGroupRegex = /<div[^>]*class="[^"]*(?:b-facility-group|hotel-facilities-group|fac-group-title)[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*(?:b-facility-group__title|hotel-facilities-group__title|fac-group-title)[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/gi;
    let groupMatch;
    while ((groupMatch = facilityGroupRegex.exec(html)) !== null) {
      const groupName = decodeHtmlEntities(groupMatch[1].replace(/<[^>]+>/g, '').trim());
      const groupKey = groupName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const itemsHtml = groupMatch[2];
      
      const items = [];
      const itemRegex = /<li[^>]*>[\s\S]*?<span[^>]*class="[^"]*(?:b-facility-item__label|hotel-facilities-group__list-item)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
      let itemMatch;
      while ((itemMatch = itemRegex.exec(itemsHtml)) !== null) {
        const item = decodeHtmlEntities(itemMatch[1].replace(/<[^>]+>/g, '').trim());
        if (item && !items.includes(item)) {
          items.push(item);
          if (!allFacilities.includes(item)) allFacilities.push(item);
        }
      }
      
      if (items.length > 0) {
        groupedFacilities[groupKey] = items;
      }
    }
    
    // Fallback: If no grouped facilities found, try simpler data-testid or class patterns
    if (Object.keys(groupedFacilities).length === 0) {
      const knownFacilities = ['Free WiFi', 'WiFi', 'Pool', 'Swimming pool', 'Gym', 'Fitness center', 
        'Spa', 'Restaurant', 'Bar', 'Room service', 'Parking', 'Free parking', 'Air conditioning',
        'Airport shuttle', 'Beach', 'Breakfast', 'Pet friendly', '24-hour front desk', 'Non-smoking rooms',
        'Family rooms', 'Terrace', 'Garden', 'Hot tub', 'Sauna', 'Laundry', 'Kitchen', 'Balcony'];
      
      for (const fac of knownFacilities) {
        if (html.includes(fac) && !allFacilities.includes(fac)) {
          allFacilities.push(fac);
        }
      }
    }
    
    details.facilities = allFacilities.slice(0, 30);
    details.grouped_facilities = groupedFacilities;
    
    // ===== RESTAURANTS ON SITE =====
    const restaurants = [];
    // Pattern: "Restaurants on Site" followed by restaurant blocks
    const restaurantsSectionMatch = html.match(/Restaurants\s+([Oo]n\s+[Ss]ite|[Aa]vailable)[\s\S]*?<div[^>]*data-testid="property-restaurants"[^>]*>([\s\S]*?)<\/div><\/div>/i);
    if (restaurantsSectionMatch) {
      const restaurantBlockRegex = /<div[^>]*data-testid="restaurant-card"[^>]*>([\s\S]*?)<\/div><\/div>/gi;
      let restBlockMatch;
      while ((restBlockMatch = restaurantBlockRegex.exec(restaurantsSectionMatch[2])) !== null) {
        const blockHtml = restBlockMatch[1];
        const rest = {};
        
        const nameMatch = blockHtml.match(/<h[34][^>]*>([^<]+)<\/h[34]>/i) || blockHtml.match(/class="[^"]*restaurant-name[^"]*"[^>]*>([^<]+)</i);
        if (nameMatch) rest.name = decodeHtmlEntities(nameMatch[1].trim());
        
        // Extract meta info (Cuisine, Open for, Ambience)
        const cuisineMatch = blockHtml.match(/Cuisine:?<\/span>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i) || blockHtml.match(/Cuisine<\/div>[\s\S]*?<div[^>]*>([^<]+)<\/div>/i);
        if (cuisineMatch) rest.cuisine = decodeHtmlEntities(cuisineMatch[1].trim());
        
        const openMatch = blockHtml.match(/Open for:?<\/span>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i) || blockHtml.match(/Open for<\/div>[\s\S]*?<div[^>]*>([^<]+)<\/div>/i);
        if (openMatch) rest.open_for = decodeHtmlEntities(openMatch[1].trim());
        
        const ambienceMatch = blockHtml.match(/Ambience:?<\/span>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i) || blockHtml.match(/Ambience<\/div>[\s\S]*?<div[^>]*>([^<]+)<\/div>/i);
        if (ambienceMatch) rest.ambience = decodeHtmlEntities(ambienceMatch[1].trim());
        
        const dietaryMatch = blockHtml.match(/Dietary options:?<\/span>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i) || blockHtml.match(/Dietary options<\/div>[\s\S]*?<div[^>]*>([^<]+)<\/div>/i);
        if (dietaryMatch) rest.dietary_options = decodeHtmlEntities(dietaryMatch[1].trim());
        
        if (rest.name) restaurants.push(rest);
      }
    }
    
    // Fallback restaurants from JSON-LD or simpler text patterns
    if (restaurants.length === 0) {
      const restMetaMatch = html.match(/"@type"\s*:\s*"Restaurant"[^}]*?"name"\s*:\s*"([^"]+)"/gi);
      if (restMetaMatch) {
        restMetaMatch.forEach(m => {
          const name = m.match(/"name"\s*:\s*"([^"]+)"/i)[1];
          if (name && !restaurants.find(r => r.name === name)) {
            restaurants.push({ name: decodeHtmlEntities(name) });
          }
        });
      }
    }
    
    details.restaurants = restaurants;
    
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
    
    // ===== AREA INFO / NEARBY PLACES - ROBUST DYNAMIC EXTRACTION =====
    const areaInfo = {};
    
    try {
      const categoryToKey = (cat) => {
        return cat.toLowerCase()
          .replace(/&amp;/g, 'and')
          .replace(/&/g, 'and')
          .replace(/[''"]/g, '')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');
      };

      // Diagnostic: Find the Area Info section and log its context
      const areaTitleIdx = html.search(/>(?:Area info|Property surroundings|What's nearby)</i);
      if (areaTitleIdx !== -1) {
        const fragment = html.substring(areaTitleIdx - 50, areaTitleIdx + 2000).replace(/\s+/g, ' ');
        console.log('[DEBUG] Area Info fragment (expanded):', fragment.substring(0, 500));
        // Check for common skeleton class
        if (fragment.includes('skeleton')) {
          console.warn('[SCRAPER] Warning: Skeletons detected in HTML fragment!');
        }
      }

      // 1. Identify the entire surroundings section to limit the scope
      const surroundingsBlockMatch = html.match(/class=\"[^\"]*property-surroundings[^\"]*\"[^>]*>([\s\S]*?)<\/section>/i) ||
                                    html.match(/>(?:Area info|Property surroundings)<\/h2>([\s\S]*?)<\/section>/i);
      
      const scopeHtml = surroundingsBlockMatch ? surroundingsBlockMatch[1] : html;

      // Discovery: Look for category headings and subsequent lists
      // Modified pattern: look for text followed by listitems more generically
      const discoveryPattern = />\s*([^<]{3,40})\s*<\/[^>]+>[\s\S]{0,800}?(<[^>]+role=\"listitem\"[^>]*>[\s\S]*?)<\/(?:section|div|ul)/gi;
      let dMatch;
      while ((dMatch = discoveryPattern.exec(scopeHtml)) !== null) {
        const categoryName = dMatch[1].replace(/<[^>]+>/g, '').trim();
        const categoryKey = categoryToKey(categoryName);
        const itemsHtml = dMatch[2];
        
        if (!categoryKey || categoryKey.length < 2 || /area_info|show_map|availability|reviews|check|property_surroundings/i.test(categoryKey)) continue;
        
        // Skip keys that look like distances (e.g. "40_m", "0_7_mi")
        if (/^\d+(_\d+)?(?:_km|_m|_mi)?$/.test(categoryKey)) continue;
        
        if (categoryName.includes('?') || categoryName.includes('}') || categoryName.length > 50) continue;

        const items = [];
        const itemRegex = /<[^>]+role=\"listitem\"[^>]*>([\s\S]*?)<\/[^>]+>/gi;
        let itemMatch;
        while ((itemMatch = itemRegex.exec(itemsHtml)) !== null) {
          const itemContent = itemMatch[1];
          // Strip HTML but keep some markers for parsing
          const fullText = itemContent.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
          
          if (!fullText || fullText.length < 2) continue;

          // Match distance like "1.2 km", "450 m", "0.7 mi", "15km", "0.5mi"
          const distRegex = /(\d+(?:\.\d+)?\s*(?:km|m|mi))\b/i;
          const distMatch = fullText.match(distRegex);
          const distance = distMatch ? distMatch[1].trim() : null;
          
          // Name cleaning: remove distance and common prefixes
          let name = fullText;
          if (distance) {
            name = name.replace(distMatch[0], '').trim();
          }
          
          // Remove bullet points / dots / prefixes like "Restaurant ·" or "Restaurant "
          name = name.replace(/^[•·]\s*/, '')
                     .replace(/^(?:Restaurant|Cafe|Subway|Train|Airport|Metro|Museum|Park|Bank|Pharmacy|Market|Tram|Bus|Square)\s*[•·\s-]\s*/i, '')
                     .replace(/\s*[•·\s-]\s*$/, '')
                     .trim();

          if (name && name.length > 1 && !name.includes('...')) {
            // Avoid adding duplicates if they appear due to overlapping regex matches
            if (!items.find(i => i.name === name)) {
              items.push({ name, distance });
            }
          }
        }
        if (items.length > 0) areaInfo[categoryKey] = items;
      }

      // 3. Fallback for specific categories if discovery missed them
      if (Object.keys(areaInfo).length < 2) {
        const labels = ["What's nearby", "Top attractions", "Closest Airports", "Public transit", "Restaurants & cafes", "Natural beauty"];
        labels.forEach(label => {
          const labelKey = categoryToKey(label);
          if (areaInfo[labelKey]) return;

          const pattern = new RegExp(`>\\s*${label}\\s*<[\\s\\S]{0,500}?(<[^>]+role=\"listitem\"[\\s\\S]*?)<\\/(?:section|div|ul)`, 'i');
          const m = scopeHtml.match(pattern);
          if (m) {
            const its = [];
            const ir = /role=\"listitem\"[^>]*>([\s\S]*?)<\/(?:li|div)/gi;
            let im;
            while ((im = ir.exec(m[1])) !== null) {
              const text = im[1].replace(/<[^>]+>/g, ' ').trim();
              const d = text.match(/(\d+\.?\d*\s*(?:km|m|mi))/i);
              if (text) its.push({ name: text.replace(d ? d[1] : '', '').trim(), distance: d ? d[1] : null });
            }
            if (its.length > 0) areaInfo[labelKey] = its;
          }
        });
      }
      
      // JSON-LD/Metadata Fallback for Airports (very reliable)
      const airports = [];
      const airportJsonPattern = /"title":"([^"]*Airport[^"]*)","subtitle":"\(([A-Z]+)\)\s*(\d+\.?\d*)\s*(km|mi)"/gi;
      let airportMatch;
      while ((airportMatch = airportJsonPattern.exec(html)) !== null) {
        const name = decodeHtmlEntities(airportMatch[1].trim());
        const code = airportMatch[2];
        const distance = airportMatch[3] + ' ' + airportMatch[4];
        if (!airports.find(a => a.name === name)) {
          airports.push({ name, code, distance });
        }
      }
      if (airports.length > 0 && !areaInfo.closest_airports) areaInfo.closest_airports = airports;
    } catch (areaErr) {
      console.error('[DETAILS] Area info extraction error:', areaErr.message);
    }
    
    details.area_info = areaInfo;
    
    // Extract city from JSON
    const locationJsonMatch = html.match(/"location"\s*:\s*\{[^}]*"city"\s*:\s*"([^"]+)"[^}]*\}/i) ||
                             html.match(/"addressLocality"\s*:\s*"([^"]+)"/i);
    details.city = locationJsonMatch ? decodeHtmlEntities(locationJsonMatch[1]) : null;
    
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
      const houseRulesMatch = html.match(/House\s+[Rr]ules[\s\S]*?<(?:p|div)[^>]*class="[^"]*(?:property-description|policy_conditions|hp_policy_description)[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                             html.match(/data-testid="property-section-policies"[^>]*>([\s\S]*?)<\/section>/i) ||
                             html.match(/id="policy_conditions"[^>]*>([\s\S]*?)<\/div>/i);
      if (houseRulesMatch) {
        let rulesText = houseRulesMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (rulesText.length > 20 && !rulesText.includes('Rue Pierre Demours')) { // Basic check to avoid address leakage
           propertyInfo.house_rules = decodeHtmlEntities(rulesText);
        }
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
    const execPath = await chromium.executablePath();
    
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
      ],
      defaultViewport: { width: 1920, height: 1080 },
      executablePath: execPath,
      headless: true,
      ignoreHTTPSErrors: true,
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
    
    // Redirect browser console logs to terminal for debugging
    page.on('console', msg => {
      console.log(`[BROWSER] ${msg.text()}`);
    });
    
    if (!isServerless) {
      await page.setViewport({ width: 1920, height: 1080 });
    }
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });
    
    const waitUntil = isServerless ? 'domcontentloaded' : 'networkidle2';
    await page.goto(hotelURL, { waitUntil, timeout: TIMING.navigationTimeout });
    
    // Wait for body to exist
    try {
      await page.waitForSelector('body', { timeout: 15000 });
    } catch (e) {
      console.warn('[SCRAPER] Body timeout, proceeding with current content');
    }

    // Wait for critical hotel name element to ensure page is loaded
    try {
      await page.waitForSelector('[data-testid="header-hotel-name"], h2.pp-header__title, #hp_hotel_name, .hp__hotel-name', { timeout: 20000 });
      console.log('[SCRAPER] Hotel name element detected');
    } catch (e) {
      console.warn('[SCRAPER] Hotel name selector timeout - page may be slow or blocked');
    }
    
    // Additional wait for content to load
    await randomDelay(2000, 3000);
    
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
    });
      
    // Proactive scrolling to trigger lazy loading of surroundings and other sections
    console.log('[SCRAPER] Scrolling to trigger lazy loading...');
    
    // Targeted scroll to surroundings section to ensure it's loaded
    await page.evaluate(() => {
      const areaH2 = Array.from(document.querySelectorAll('h2')).find(h => 
        /Area info|Property surroundings|What's nearby/i.test(h.textContent)
      );
      if (areaH2) {
        areaH2.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        window.scrollTo(0, document.body.scrollHeight / 2);
      }
    });
    await randomDelay(1000, 2000);

    await autoScroll(page, 8, 800);
    
    // Wait for the surroundings section to hydrate (move from skeleton to real text)
    // We look for any element inside the POI block that has a character length > 2
    try {
      console.log('[SCRAPER] Waiting for surroundings hydration...');
      await page.waitForFunction(() => {
        const areaSection = Array.from(document.querySelectorAll('h2')).find(h => 
          /Area info|Property surroundings|What's nearby/i.test(h.textContent)
        );
        if (!areaSection) return false;
        const container = areaSection.closest('section') || areaSection.parentElement.parentElement;
        const items = Array.from(container.querySelectorAll('[role="listitem"], .aa225776f2, .poi-block__item'));
        return items.length > 5 && items.some(i => i.textContent.trim().length > 10 && !i.querySelector('.skeleton'));
      }, { timeout: 25000 });
      console.log('[SCRAPER] Surroundings hydrated and text detected');
    } catch (e) {
      console.warn('[SCRAPER] Hydration wait timed out - proceeding with best effort');
    }
    
    await randomDelay(1500, 2500);
    
    // Attempt to click "Show more" in Property surroundings / Area info section
    try {
      await page.evaluate(() => {
        const areaSection = Array.from(document.querySelectorAll('h2')).find(h => 
          /Area info|Property surroundings|What's nearby/i.test(h.textContent)
        );
        if (areaSection) {
          const container = areaSection.closest('section') || areaSection.parentElement.parentElement;
          const showMoreBtn = container.querySelector('button[aria-expanded="false"]');
          if (showMoreBtn) {
            showMoreBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showMoreBtn.click();
            console.log('[SCRAPER] Clicked "Show more" in Area Info');
          }
        }
      });
      await randomDelay(1000, 2000);
    } catch (e) {
      console.warn('[SCRAPER] Failed to click "Show more" in Area Info:', e.message);
    }
    
    await randomDelay(1000, 2000);
    
    // Proactive overlay dismissal
    await dismissOverlays(page);
    
    // Scroll a bit more to trigger more lazy loading
    await page.evaluate(() => window.scrollBy(0, 500));
    await delay(800);
    
    const html = await page.content();
    if (html.length < 50000) {
      console.warn('[SCRAPER] Page content very short, might be blocked. Length:', html.length);
      console.log('[DEBUG] Start of HTML:', html.substring(0, 500));
    } else {
      console.log('[SCRAPER] Page content length:', html.length);
    }
    
    // Extract details first
    const details = extractHotelDetailsFromHTML(html);
    
    // Supplement with browser-side precision extraction for Area Info
    try {
      console.log('[SCRAPER] Extracting Area Info via browser DOM...');
      const browserAreaInfo = await page.evaluate(() => {
        const areaInfo = {};
        const areaSection = Array.from(document.querySelectorAll('h2')).find(h => 
          /Area info|Property surroundings|What's nearby/i.test(h.textContent)
        );
        if (!areaSection) return null;
        
        const container = areaSection.closest('section') || areaSection.parentElement.parentElement;
        
        // Find all headings that represent categories
        const headings = Array.from(container.querySelectorAll('div[class*="title"], h3, h4, [class*="category_title"], [class*="heading"]'));
        
        headings.forEach(heading => {
          const categoryName = heading.textContent.trim();
          if (categoryName.length < 3 || categoryName.length > 50) return;
          if (/Area info|Property surroundings|Show map|See availability/i.test(categoryName)) return;
          // Skip distances misidentified as headings
          if (/^(\d+\.?\d*\s*(?:km|m|mi))$/i.test(categoryName)) return;
          
          const categoryKey = categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
          
          // Find list items in the same container or next sibling
          let section = heading.parentElement;
          let listItems = Array.from(section.querySelectorAll('[role="listitem"]'));
          
          // If no items, try looking at the parent of the parent or the next sibling
          if (listItems.length === 0) {
            section = heading.parentElement.parentElement;
            listItems = Array.from(section.querySelectorAll('[role="listitem"]'));
          }
          
          if (listItems.length === 0 && heading.nextElementSibling) {
            listItems = Array.from(heading.nextElementSibling.querySelectorAll('[role="listitem"]'));
          }
          
          if (listItems.length > 0) {
            const items = listItems.map(li => {
              // Join child nodes with spaces to avoid concatenation issues (e.g. "RestaurantSarl")
              const textParts = [];
              const walk = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, null, false);
              let node;
              while(node = walk.nextNode()) textParts.push(node.textContent.trim());
              const fullText = textParts.filter(t => t.length > 0).join(' ').replace(/\s+/g, ' ').trim();
              
              // Match distance like "1.2 km", "450 m", "0.7 mi", "15km", "5 m"
              const distRegex = /(\d+(?:\.\d+)?\s*(?:km|m|mi))\b/i;
              const distMatch = fullText.match(distRegex);
              const distance = distMatch ? distMatch[1].trim() : null;
              
              let name = fullText;
              if (distance) {
                // Remove the matched distance from the name
                name = name.replace(distMatch[0], '').trim();
              }
              
              // Remove generic prefixes and separators (now with optional spaces/tabs)
              name = name.replace(/^[•·]\s*/, '')
                         .replace(/^(?:Restaurant|Cafe|Subway|Train|Airport|Metro|Museum|Park|Bank|Pharmacy|Market|Tram|Bus|Square|Forest)\s*[•·\s-]*\s*/i, '')
                         .replace(/\s*[•·\s-]\s*$/, '')
                         .trim();
              
              // Special case for concatenated prefixes if any remain
              const prefixes = ['Restaurant', 'Cafe', 'Subway', 'Train', 'Airport', 'Metro', 'Museum', 'Park', 'Bank', 'Pharmacy', 'Market', 'Tram', 'Bus', 'Square', 'Forest'];
              for (const p of prefixes) {
                if (name.startsWith(p) && name.length > p.length && /[A-Z]/.test(name[p.length])) {
                  name = name.substring(p.length).trim();
                  break;
                }
              }

              return { name, distance };
            }).filter(i => i.name.length > 1);
            
            if (items.length > 0) {
              if (!areaInfo[categoryKey]) areaInfo[categoryKey] = [];
              items.forEach(item => {
                if (!areaInfo[categoryKey].find(existing => existing.name === item.name)) {
                  areaInfo[categoryKey].push(item);
                }
              });
            }
          }
        });
        
        return Object.keys(areaInfo).length > 0 ? areaInfo : null;
      });
      
      if (browserAreaInfo) {
        console.log('[SCRAPER] Browser-side Area Info merged:', Object.keys(browserAreaInfo));
        details.area_info = { ...details.area_info, ...browserAreaInfo };
      }
    } catch (e) {
      console.warn('[SCRAPER] Browser Area Info extraction failed:', e.message);
    }
    
    details.url = hotelURL;
    return details;
    
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

module.exports = { scrapeBookingHotels, scrapeHotelDetails, buildSearchURL, scrapeWeather };
