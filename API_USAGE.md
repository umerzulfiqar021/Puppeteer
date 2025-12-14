# Hotel Scraper API

## Start Server
```bash
node local_server.js
```
Server runs at: `http://localhost:3000`

---

## 1. Search Hotels by Location

**Endpoint:** `POST /api/hotels`

### Using curl (Terminal)
```bash
# Basic (pretty output with colors)
curl -s http://localhost:3000/api/hotels \
  -H "Content-Type: application/json" \
  -d '{"location": "bristol"}' | jq .

# With dates
curl -s http://localhost:3000/api/hotels \
  -H "Content-Type: application/json" \
  -d '{"location": "dubai", "checkin": "2025-12-20", "checkout": "2025-12-22"}' | jq .
```

### Using JavaScript/NestJS
```javascript
// Using fetch
const response = await fetch('http://localhost:3000/api/hotels', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    location: 'dubai',
    // Optional parameters:
    checkin: '2025-12-20',   // optional - default: tomorrow
    checkout: '2025-12-22',  // optional - default: 2 days after checkin
    adults: 2,               // optional - default: 2
    rooms: 1                 // optional - default: 1
  })
});
const data = await response.json();
console.log(data);

// Using axios (minimal - only required field)
const axios = require('axios');
const { data } = await axios.post('http://localhost:3000/api/hotels', {
  location: 'dubai'  // only location is required!
});

// Using axios (with all options)
const { data } = await axios.post('http://localhost:3000/api/hotels', {
  location: 'dubai',
  checkin: '2025-12-20',
  checkout: '2025-12-22',
  adults: 2,
  rooms: 1
});
```

### Request Parameters
| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `location` | ✅ Yes | - | City name (dubai, london, paris) |
| `checkin` | ❌ No | tomorrow | Check-in date (YYYY-MM-DD) |
| `checkout` | ❌ No | checkin + 2 days | Check-out date (YYYY-MM-DD) |
| `adults` | ❌ No | 2 | Number of adults |
| `rooms` | ❌ No | 1 | Number of rooms |

### Response
```json
{
  "success": true,
  "location": "dubai",
  "count": 27,
  "hotels": [
    {
      "name": "FIVE Jumeirah Village",
      "link": "https://www.booking.com/hotel/ae/five-jumeirah-village.html",
      "picture_url": "https://cf.bstatic.com/...",
      "rating": 9.2,
      "reviews_count": 32900,
      "location": "Jumeirah Village Circle",
      "price_per_night": "1000"
    }
  ]
}
```

---

## 2. Get Hotel Details

**Endpoint:** `POST /api/hotel-details`

### Using curl (Terminal)
```bash
curl -s http://localhost:3000/api/hotel-details \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.booking.com/hotel/ae/five-jumeirah-village.html"}' | jq .
```

### Using JavaScript/NestJS
```javascript
// Using fetch
const response = await fetch('http://localhost:3000/api/hotel-details', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    url: 'https://www.booking.com/hotel/ae/five-jumeirah-village.html' 
  })
});
const data = await response.json();

// Using axios
const { data } = await axios.post('http://localhost:3000/api/hotel-details', {
  url: 'https://www.booking.com/hotel/ae/five-jumeirah-village.html'
});
```

### Request Parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | ✅ Yes | Full Booking.com hotel URL |

### Response
```json
{
  "success": true,
  "duration_seconds": 9.35,
  "hotel": {
    "name": "FIVE Jumeirah Village",
    "address": "Jumeirah Village Circle Dubai, Dubai, UAE",
    "rating": 9,
    "reviews_count": 32900,
    "rating_text": "Wonderful",
    "stars": 5,
    "description": "Located in Dubai, 5 mi from Dubai Autodrome...",
    "main_photo": "https://cf.bstatic.com/xdata/images/hotel/...",
    "photos": ["https://...", "https://..."],
    "facilities": ["WiFi", "Pool", "Spa", "Gym", "Restaurant", "Bar", "Parking"],
    "rooms": [{"name": "Deluxe Room", "price": "1000", "currency": "AED"}],
    "checkin_time": "3:00",
    "checkout_time": "12:00",
    "coordinates": {"latitude": 25.05, "longitude": 55.20},
    "highlights": ["Free private parking"],
    "area_info": {
      "restaurants_cafes": [
        {"name": "Giftto Cafe", "distance": "2 km"},
        {"name": "Nadeem Wahid Tea Stall", "distance": "4.5 km"}
      ],
      "public_transit": [
        {"name": "Sialkot Train Station", "distance": "4.2 km"},
        {"name": "Gunna Kalan RS", "distance": "15 km"}
      ],
      "airports": [
        {"name": "Sialkot International Airport", "distance": "8 km"}
      ],
      "attractions": []
    },
    "url": "https://www.booking.com/hotel/ae/five-jumeirah-village.html"
  }
}
```

---

## 3. Health Check

```bash
curl http://localhost:3000/api/health | jq .
```

---

## What Each Part Means

| Part | Meaning |
|------|---------|
| `curl` | Command line tool to make HTTP requests |
| `-s` | Silent mode (no progress bar) |
| `-H "Content-Type: application/json"` | Header: tells server we're sending JSON |
| `-d '{"location": "dubai"}'` | Data: the JSON body to send |
| `| jq .` | Pipe to jq: formats output with colors (green/blue) |

---

## When Hosted on Server

Replace `localhost:3000` with your server URL:

```bash
# Local
curl http://localhost:3000/api/hotels ...

# Production (example)
curl https://your-server.com/api/hotels ...
curl https://api.itours.com/api/hotels ...
```

### NestJS Service Example
```typescript
// hotels.service.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface SearchHotelsParams {
  location: string;      // required
  checkin?: string;      // optional (YYYY-MM-DD)
  checkout?: string;     // optional (YYYY-MM-DD)
  adults?: number;       // optional (default: 2)
  rooms?: number;        // optional (default: 1)
}

@Injectable()
export class HotelsService {
  // Replace with your hosted URL
  private apiUrl = 'http://localhost:3000';  // or 'https://your-server.com'

  constructor(private http: HttpService) {}

  // Search hotels - only location is required, rest are optional
  async searchHotels(params: SearchHotelsParams) {
    const response = await firstValueFrom(
      this.http.post(`${this.apiUrl}/api/hotels`, params)
    );
    return response.data;
  }

  // Get hotel details
  async getHotelDetails(url: string) {
    const response = await firstValueFrom(
      this.http.post(`${this.apiUrl}/api/hotel-details`, { url })
    );
    return response.data;
  }
}

// Usage in controller:
// Minimal (only required)
// await hotelsService.searchHotels({ location: 'dubai' });

// With optional dates
// await hotelsService.searchHotels({ 
//   location: 'dubai', 
//   checkin: '2025-12-20', 
//   checkout: '2025-12-22' 
// });

// Get specific hotel details (pass the hotel URL from search results)
// await hotelsService.getHotelDetails('https://www.booking.com/hotel/ae/five-jumeirah-village.html');
```

---

## Quick Examples

```bash
# Search Dubai hotels (with pretty colors)
curl -s http://localhost:3000/api/hotels -H "Content-Type: application/json" -d '{"location":"dubai"}' | jq .

# Get hotel details (with pretty colors)  
curl -s http://localhost:3000/api/hotel-details -H "Content-Type: application/json" -d '{"url":"https://www.booking.com/hotel/ae/five-jumeirah-village.html"}' | jq .

# Health check
curl -s http://localhost:3000/api/health | jq .
```
curl -s http://localhost:3000/api/hotel-details \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.booking.com/hotel/gb/ebhibristolcitycentre.html?checkin=2025-12-15&checkout=2025-12-17&group_adults=2&no_rooms=1&group_children=0"}' | jq .