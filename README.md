# Company SEO Rank Checker

Internal dashboard + Chrome extension that checks Google ranking positions for a domain using browser-side scraping.

## Architecture

- `apps/web`: Next.js 14+ App Router dashboard and backend API.
- `extension`: Chrome Extension (Manifest V3) that fetches and parses Google SERP in the employee browser.

## Why This Architecture

- No server-side Google scraping.
- Google requests happen in the employee's real Chrome browser session.
- Backend only handles matching logic and response formatting.

## Project Structure

- `apps/web/app`: UI and API routes.
- `apps/web/components`: dashboard UI blocks.
- `apps/web/lib/utils`: pure URL normalization and rank detection logic.
- `apps/web/lib/providers`: engine registry (Google active, Bing placeholder).
- `extension/manifest.json`: extension config.
- `extension/background.js`: service worker.
- `extension/content.js`: Google SERP parser.
- `extension/src/*.ts`: typed source mirrors for extension logic.

## Local Development

1. Install web app deps:
   - `cd apps/web`
   - `npm install`
2. Create env file:
   - Copy `apps/web/.env.example` to `apps/web/.env.local`
   - Set `NEXT_PUBLIC_CHROME_EXTENSION_ID`
3. Run dashboard:
   - `npm run dev`
4. Open `http://localhost:3000`

## Load Extension (Chrome Developer Mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension` folder from this repository.
5. Copy the generated extension ID.
6. Put that value in `apps/web/.env.local` as `NEXT_PUBLIC_CHROME_EXTENSION_ID`.
7. Restart `npm run dev`.

## End-to-End Local Test

1. Confirm top banner in dashboard shows `Extension Active`.
2. Enter keyword (example: `running shoes`) and domain (example: `nike.com`).
3. Click `Check Rank`.
4. Extension opens hidden Google tab, parses results, sends raw URLs.
5. Dashboard posts data to `POST /api/rank-check`.
6. Result card shows found position/page or not found in top scanned results.

## Deploy to Vercel

1. Push repository to Git.
2. Import `apps/web` as the Vercel project root.
3. Add environment variable:
   - `NEXT_PUBLIC_CHROME_EXTENSION_ID`
4. Update `extension/manifest.json`:
   - Add your production dashboard domain under `externally_connectable.matches`.
   - Add it under `host_permissions` if needed.
5. Re-load extension in Chrome after manifest updates.

## API

### `POST /api/rank-check`

Request body:

```json
{
  "keyword": "running shoes",
  "domain": "nike.com",
  "engine": "google",
  "results": [
    {
      "position": 1,
      "url": "https://example.com",
      "title": "Example",
      "snippet": "..."
    }
  ]
}
```

Response includes:

- `status`: `found` | `not_found` | `invalid_input`
- `position`
- `page`
- `matchedUrl`
- `checkedAt`

## Updating Google CSS Selectors

If Google layout changes and parsing breaks, update selectors in:

- `extension/content.js`
- `extension/src/content.ts`

Current fallback selector groups:

- `div#search .MjjYud`
- `div#search .g`
- `div#search .Gx5Zad`

Current anchor fallbacks:

- `a[href]`
- `.yuRUbf a`
- `[data-ved] a[href]`

After selector updates, reload the extension in `chrome://extensions`.

## Notes

- Bing is present as a disabled option for future expansion.
- Subdomains are treated as distinct domains (`blog.nike.com` != `nike.com`).
- If results array is empty, API returns a CAPTCHA/layout warning error.
