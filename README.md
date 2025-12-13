# Booking.com Hotel Scraper

A professional Node.js scraper for extracting hotel data from Booking.com search results. Built with Puppeteer-Extra and Stealth Plugin for anti-bot evasion.

## Features

- **Stealth Mode**: Uses `puppeteer-extra-plugin-stealth` to bypass bot detection
- **Random User-Agent**: Rotates through common desktop browser User-Agents
- **Request Interception**: Blocks images, fonts, CSS for faster loading
- **Human-like Behavior**: Randomized delays between actions
- **Lazy Loading Support**: Auto-scrolls to trigger dynamic content loading
- **Cookie Banner Handling**: Automatically dismisses consent dialogs

## Project Structure

```
.
├── package.json          # Dependencies and scripts
├── .env                  # Environment configuration
├── .gitignore            # Git ignore rules
├── local_server.js       # HTTP server for testing
├── README.md             # This file
└── scraper/
    ├── index.js          # Main entry point (stdin/stdout)
    ├── booking.js        # Core scraping logic
    └── config.js         # Selectors, User-Agents, timing config
```

## Installation

```bash
# Install dependencies
yarn install
```

## Usage

### CLI Mode (stdin/stdout)

```bash
# Run with JSON input
echo '{"location":"Paris"}' | yarn start

# Or using npm test
yarn test  # Tests with "murree" location
```

### HTTP Server Mode

```bash
# Start the server
yarn server

# In another terminal, make a request
curl -X POST http://localhost:3000/scrape \
  -H "Content-Type: application/json" \
  -d '{"location":"Paris"}'
```

## Output Format

The scraper extracts the following fields for each hotel:

```json
{
  "name": "Hotel Name",
  "link": "https://www.booking.com/hotel/...",
  "picture_url": "https://cf.bstatic.com/...",
  "rating": 8.5,
  "reviews_count": 1234,
  "location": "City Center, Paris",
  "price_per_night": "150"
}
```

## Configuration

Edit `scraper/config.js` to customize:

- **USER_AGENTS**: Pool of User-Agent strings for rotation
- **SELECTORS**: CSS selectors for data extraction
- **TIMING**: Delays and timeouts
- **BLOCKED_RESOURCES**: Resource types to block

## Environment Variables

Create a `.env` file:

```env
# Server port (default: 3000)
PORT=3000

# Optional: Zyte proxy for production
# ZYTE_PROXY=http://apikey:@proxy.zyte.com:8011
```

## Dependencies

- `puppeteer-extra` - Enhanced Puppeteer with plugin support
- `puppeteer-extra-plugin-stealth` - Anti-bot detection evasion
- `puppeteer` - Headless Chrome automation
- `dotenv` - Environment variable loading

## Notes

- This scraper is for educational/research purposes
- Respect Booking.com's robots.txt and terms of service
- Use responsibly with appropriate delays between requests
- For production use, consider using a proxy service like Zyte
