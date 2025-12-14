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
    // Hotel name - from JSON-LD schema first (most reliable)
    const schemaMatch = html.match(/"@type"\s*:\s*"Hotel"[\s\S]*?"name"\s*:\s*"([^"]+)"/i);
    const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
    const h1Match = html.match(/<h1[^>]*>([^<]{3,100})<\/h1>/i);
    const titleMatch = html.match(/<title>([^<|]+)/i);
    
    if (schemaMatch) {
      details.name = decodeHtmlEntities(schemaMatch[1].trim());
    } else if (ogTitleMatch) {
      details.name = decodeHtmlEntities(ogTitleMatch[1].split('|')[0].trim());
    } else if (h1Match) {
      details.name = decodeHtmlEntities(h1Match[1].trim());
    } else if (titleMatch) {
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
  
  const userAgent = getRandomUserAgent();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });
    
    await randomDelay(500, 1500);
    await page.goto(hotelURL, { waitUntil: 'networkidle2', timeout: TIMING.navigationTimeout });
    
    // Dismiss overlays
    await dismissOverlays(page);
    
    // Scroll to load lazy content
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await randomDelay(1000, 2000);
    
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
