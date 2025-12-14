# Booking.com Scraper API

A REST API for scraping hotel data from Booking.com using Puppeteer.

---

## Quick Start

```bash
node local_server.js
```

**Base URL:** `http://localhost:3000` (replace with your domain when hosted)

---

## Endpoints

### 1. Health Check

**GET** `/api/health`

Check if the server is running.

#### Terminal

```bash
curl -s http://localhost:3000/api/health | jq '.'
```

---

### 2. Search Hotels

**POST** `/api/hotels`

Search for hotels in a destination.

#### Request Body

```javascript
{
  location: "Dubai",
  checkin: "2025-12-20",
  checkout: "2025-12-25",
  adults: 2,
  children: 1,
  rooms: 1
}
```

| Parameter | Type   | Required | Description                          |
|-----------|--------|----------|--------------------------------------|
| location  | string | ✅       | City or location name                |
| checkin   | string | ✅       | Check-in date (YYYY-MM-DD)           |
| checkout  | string | ✅       | Check-out date (YYYY-MM-DD)          |
| adults    | number | ❌       | Number of adults (default: 2)        |
| children  | number | ❌       | Number of children (default: 0)      |
| rooms     | number | ❌       | Number of rooms (default: 1)         |

> **Note:** Prices are returned in USD (`currency: "$"`).

#### Terminal

```bash
curl -s -X POST http://localhost:3000/api/hotels \
  -H "Content-Type: application/json" \
  -d '{
    "location": "New York",
    "checkin": "2026-02-01",
    "checkout": "2026-02-05",
    "adults": 2,
    "children": 1,
    "rooms": 1
  }' | jq '.'
```

#### NestJS

```typescript
const response = await this.httpService.axiosRef.post(
  `${BASE_URL}/api/hotels`,
  {
    location: "Dubai",
    checkin: "2025-12-20",
    checkout: "2025-12-25",
    adults: 2,
    children: 1,
    rooms: 1
  }
);
return response.data;
```

---

### 3. Get Hotel Details

**POST** `/api/hotel-details`

Get detailed information about a specific hotel.

#### Request Body

```javascript
{
  url: "https://www.booking.com/hotel/ae/the-st-regis-downtown-dubai.html"
}
```

| Parameter | Type   | Required | Description                      |
|-----------|--------|----------|----------------------------------|
| url       | string | ✅       | Full Booking.com hotel URL       |

#### How to Get the URL

1. Search for hotels using `/api/hotels`
2. Copy the `url` field from any hotel in the response
3. Send it to `/api/hotel-details`

#### Terminal

```bash
curl -s -X POST http://localhost:3000/api/hotel-details \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.booking.com/hotel/us/the-premier-new-york-new-york-city.html?checkin=2025-12-20&checkout=2025-12-25&group_adults=2&no_rooms=1&group_children=1"
  }' | jq '.'
```

#### NestJS

```typescript
const response = await this.httpService.axiosRef.post(
  `${BASE_URL}/api/hotel-details`,
  {
    url: "https://www.booking.com/hotel/ae/the-st-regis-downtown-dubai.html"
  }
);
return response.data;
```

---

## Tool Reference

| Tool | Purpose                                        |
|------|------------------------------------------------|
| curl | Command-line tool to send HTTP requests        |
| jq   | Command-line JSON processor for pretty output  |

---

## Response Examples

### Health Check Response

```json
{
  "status": "ok",
  "timestamp": "2025-01-24T10:30:00.000Z",
  "scraper": "booking.com"
}
```

### Search Hotels Response

```json
{
  "success": true,
  "location": "New York",
  "count": 28,
  "duration_seconds": 20.70,
  "hotels": [
    {
      "name": "Candlewood Suites NYC - Times Square by IHG",
      "link": "https://www.booking.com/hotel/us/candlewood-suites-new-york-city.html?checkin=2025-12-20&checkout=2025-12-25&group_adults=2&no_rooms=1",
      "picture_url": "https://cf.bstatic.com/xdata/images/hotel/square240/...",
      "rating": 8.4,
      "reviews_count": 2384,
      "location": "Hell's Kitchen, New York - 1.6 km from downtown",
      "price_per_night": "1350",
      "currency": "$"
    }
  ]
}
```

### Hotel Details Response

```json
{
  "success": true,
  "hotel": {
    "name": "The St. Regis Downtown Dubai",
    "address": "Downtown Dubai, Dubai, UAE",
    "rating": 9.2,
    "reviewScore": "Superb",
    "coordinates": {
      "latitude": 25.123456,
      "longitude": 55.123456
    },
    "photos": [
      "https://cf.bstatic.com/photo1.jpg",
      "https://cf.bstatic.com/photo2.jpg"
    ],
    "facilities": [
      "Free WiFi",
      "Swimming pool",
      "Fitness center",
      "Restaurant"
    ],
    "description": "Located in the heart of Downtown Dubai...",
    "area_info": {
      "whats_nearby": [
        { "name": "Dubai Mall", "distance": "0.5 km" },
        { "name": "Burj Khalifa", "distance": "0.8 km" }
      ],
      "restaurants_and_cafes": [
        { "type": "Restaurant", "name": "Zuma", "distance": "0.3 km" },
        { "type": "Cafe", "name": "Starbucks", "distance": "0.1 km" }
      ],
      "top_attractions": [
        { "name": "Dubai Fountain", "distance": "0.6 km" }
      ],
      "beaches_in_the_neighborhood": [
        { "name": "Jumeirah Beach", "distance": "5 km" }
      ],
      "public_transit": [
        { "type": "Metro", "name": "Burj Khalifa Station", "distance": "0.4 km" }
      ],
      "closest_airports": [
        { "name": "Dubai International Airport", "code": "DXB", "distance": "15 km" }
      ]
    }
  },
  "duration": 17.32
}
```

---

## Hosting

Replace `{BASE_URL}` with your server URL:

- **Local:** `http://localhost:3000`
- **Production:** `https://your-domain.com`
