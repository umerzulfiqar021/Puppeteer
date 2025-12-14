# Booking.com Hotel Scraper API

A professional Node.js API service for scraping hotel data from Booking.com. Built with Puppeteer-Extra + Stealth Plugin and optional Zyte API proxy support for production use.

## Features

- **REST API**: Simple HTTP endpoints for backend integration
- **Stealth Mode**: Uses `puppeteer-extra-plugin-stealth` to bypass bot detection
- **Zyte API Support**: Optional proxy integration for production scaling
- **Random User-Agent**: Rotates through common desktop browser User-Agents
- **Human-like Behavior**: Randomized delays between actions
- **CORS Enabled**: Ready for cross-origin requests from your frontend

## Project Structure

```
.
├── package.json          # Dependencies and scripts
├── .env                  # Environment configuration
├── .gitignore            # Git ignore rules
├── local_server.js       # HTTP API server
├── README.md             # This file
└── scraper/
    ├── booking.js        # Core scraping logic with Zyte support
    └── config.js         # Selectors, User-Agents, timing config
```

## Installation

```bash
# Install dependencies
yarn install
```

## Configuration

Create a `.env` file:

```env
# Server Configuration
PORT=3000
HOST=0.0.0.0

# Zyte API (for production)
# Get your key from: https://app.zyte.com/o/zyte-api/api-access
ZYTE_API_KEY=your_api_key_here
USE_ZYTE=false   # Set to 'true' to enable Zyte proxy
```

## Usage

### Start the API Server

```bash
yarn server
# or
node local_server.js
```

### API Endpoints

#### POST /api/hotels

Scrape hotels for a location.

**Request:**
```json
{
  "location": "Paris",
  "checkin": "2025-01-15",
  "checkout": "2025-01-17",
  "adults": 2,
  "rooms": 1,
  "useZyte": false
}
```

Only `location` is required. All other fields are optional.

**Response:**
```json
{
  "success": true,
  "location": "Paris",
  "count": 25,
  "duration_seconds": 15.32,
  "hotels": [
    {
      "name": "Hotel Name",
      "link": "https://www.booking.com/hotel/...",
      "picture_url": "https://cf.bstatic.com/...",
      "rating": 8.5,
      "reviews_count": 1234,
      "location": "City Center - 500 m from downtown",
      "price_per_night": "15000"
    }
  ]
}
```

#### GET /api/health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "booking-scraper",
  "timestamp": "2025-12-13T12:00:00.000Z",
  "zyte_configured": false
}
```

### Example cURL Requests

```bash
# Basic request
curl -X POST http://localhost:3000/api/hotels \
  -H "Content-Type: application/json" \
  -d '{"location":"Paris"}'

# With custom dates
curl -X POST http://localhost:3000/api/hotels \
  -H "Content-Type: application/json" \
  -d '{
    "location": "New York",
    "checkin": "2025-02-01",
    "checkout": "2025-02-03",
    "adults": 2
  }'

# Health check
curl http://localhost:3000/api/health
```

### Backend Integration Example (Node.js)

```javascript
const axios = require('axios');

async function getHotels(location) {
  const response = await axios.post('http://localhost:3000/api/hotels', {
    location: location,
    checkin: '2025-01-15',
    checkout: '2025-01-17'
  });
  
  return response.data.hotels;
}

// Usage
const hotels = await getHotels('Murree');
console.log(hotels);
```

### Backend Integration Example (Python)

```python
import requests

def get_hotels(location):
    response = requests.post('http://localhost:3000/api/hotels', json={
        'location': location,
        'checkin': '2025-01-15',
        'checkout': '2025-01-17'
    })
    return response.json()['hotels']

# Usage
hotels = get_hotels('Murree')
print(hotels)
```

## Zyte API Integration

For production use, enable Zyte API proxy to avoid IP bans:

1. Get your API key from [Zyte Dashboard](https://app.zyte.com/o/zyte-api/api-access)
2. Add to your `.env`:
   ```env
   ZYTE_API_KEY=your_api_key_here
   USE_ZYTE=true
   ```
3. Or pass `useZyte: true` in individual requests

**Note:** Zyte API proxy mode works by routing browser requests through `api.zyte.com:8011`. This provides better IP rotation and ban avoidance for high-volume scraping.

## Output Format

Each hotel object contains:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Hotel name |
| `link` | string | Direct booking URL |
| `picture_url` | string | Hotel image URL |
| `rating` | number | Review score (e.g., 8.5) |
| `reviews_count` | number | Number of reviews |
| `location` | string | Address and distance |
| `price_per_night` | string | Price in local currency |

## Dependencies

- `puppeteer-extra` - Enhanced Puppeteer with plugin support
- `puppeteer-extra-plugin-stealth` - Anti-bot detection evasion
- `puppeteer` - Headless Chrome automation
- `dotenv` - Environment variable loading

## Notes

- This scraper is for educational/research purposes
- Respect Booking.com's robots.txt and terms of service
- Use responsibly with appropriate delays between requests
- For production use, use Zyte API proxy
