# Deploying Puppeteer Scraper to DigitalOcean

There are two main ways to deploy this application on DigitalOcean:

1.  **App Platform (PaaS) - Recommended**
    *   This is the easiest method. DigitalOcean will automatically detect the `Dockerfile` and build the application.
    *   Connect your GitHub repository to DigitalOcean App Platform.
    *   It will detect the Dockerfile.
    *   **Settings**:
        *   **Environment Variables**: Add your `ZYTE_API_KEY` or `BROWSERLESS_TOKEN` if you have them.
        *   **HTTP Port**: Ensure it is set to `3000`.
    *   **Pricing**: The basic container ($5/mo) might be enough for light use, but Puppeteer is memory hungry. If it crashes, upgrade to the $10/mo (1GB RAM) tier.

2.  **Droplet (VPS)**
    *   Create a Droplet with Docker pre-installed (Marketplace) or install Docker manually.
    *   Clone this repository.
    *   Build the image: `docker build -t scraper .`
    *   Run the container: `docker run -d -p 80:3000 --restart always scraper`
    *   Your API will be available at `http://your-droplet-ip`.

## Usage

Once deployed, you can access the API endpoint:

```bash
curl -X POST https://your-app-name.ondigitalocean.app/api/hotels \
  -H "Content-Type: application/json" \
  -d '{"location":"Dubai"}'
```
