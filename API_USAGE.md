# Hotel Scraper API Usage

## Start Server
```bash
node local_server.js
```

## API Endpoint
```
POST http://localhost:3000/api/hotels
```

## Request Example
```bash
curl -X POST http://localhost:3000/api/hotels \
  -H "Content-Type: application/json" \
  -d '{"location": "dubai"}'
```

## Optional Parameters
```json
{
  "location": "dubai",
  "checkin": "2025-12-20",
  "checkout": "2025-12-22",
  "adults": 2,
  "rooms": 1,
  "children": 0
}
```

## Response
```json
{
  "success": true,
  "location": "dubai",
  "hotels_count": 27,
  "hotels": [
    {
      "name": "Hotel Name",
      "link": "https://www.booking.com/hotel/...",
      "picture_url": "https://...",
      "rating": "9.2",
      "reviews_count": "1,234",
      "location": "Downtown Dubai",
      "price_per_night": "$150"
    }
  ]
}
```

## Health Check
```bash
curl http://localhost:3000/api/health
```
