# 🌐 Food Express Server

A small Node.js/Express server that proxies the Swiggy API (fixing the browser CORS block) for the Food Express React app.

## Run locally

```bash
git clone https://github.com/ramakrishnapakala/Food-Express-Server.git
cd Food-Express-Server
npm install
npm start          # http://localhost:3000
npm test           # offline tests against a fake Swiggy
```

## Endpoints

| Route | Query | Notes |
| --- | --- | --- |
| `GET /api/restaurants` | `lat`, `lng` (required), `page_type` (default `DESKTOP_WEB_LISTING`) | Restaurant list |
| `GET /api/menu` | `restaurantId`, `lat`, `lng` (required); `page-type` (default `REGULAR_MENU`), `complete-menu` (default `true`), `submitAction` (default `ENTER`) | Menu of one restaurant. The old `?pl?page-type=` spelling still works. |
| `GET /health` | | Liveness check |

Errors are always JSON with `statusCode: 1` and a `message`, so the frontend can show an error screen. Responses are cached in memory for 60 s (`X-Cache: HIT/MISS` header).

## Environment variables (all optional)

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `ALLOWED_ORIGINS` | (any) | Comma-separated list, e.g. `https://food-exprees.netlify.app,http://localhost:1234` |
| `UPSTREAM_TIMEOUT_MS` | `10000` | Swiggy request timeout |
| `CACHE_TTL_MS` | `60000` | Cache lifetime |

## Deploy

**Vercel:** import the repo; `vercel.json` is included (uses `server.js` as a serverless function).
**Render:** New Web Service → build `npm install`, start `npm start`.

> Swiggy sometimes blocks cloud/datacenter IPs. If `/api/menu` returns `502` with
> "the request may have been blocked", try redeploying to a different region/host.
