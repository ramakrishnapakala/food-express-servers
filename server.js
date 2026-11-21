const express = require("express");
const cors = require("cors");
const fetch = require("cross-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// Override SWIGGY_BASE_URL in tests / if the upstream path ever changes.
const SWIGGY_BASE = process.env.SWIGGY_BASE_URL || "https://www.swiggy.com/dapi";
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 10000;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 60 * 1000;

const UPSTREAM_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

// ---- CORS -----------------------------------------------------------------
// Open by default. To lock down, set ALLOWED_ORIGINS="https://food-exprees.netlify.app,http://localhost:1234"
const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors(allowed.length ? { origin: allowed } : undefined));

// ---- tiny in-memory cache (menus/lists change slowly; avoids hammering Swiggy) ----
const cache = new Map();
const getCached = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.data;
};
const setCached = (key, data) => {
  if (cache.size > 200) cache.delete(cache.keys().next().value); // keep memory bounded
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
};

// ---- helpers --------------------------------------------------------------
const isNum = (v) => v !== undefined && v !== "" && !Number.isNaN(Number(v));

// The React app currently calls  /api/menu?pl?page-type=REGULAR_MENU&...
// which Express parses as a key literally named "pl?page-type". Accept every
// spelling so old and new clients both work.
const pick = (query, ...names) => {
  for (const n of names) if (query[n] !== undefined) return query[n];
  const loose = Object.keys(query).find((k) => names.some((n) => k.endsWith(n)));
  return loose ? query[loose] : undefined;
};

async function proxy(res, url) {
  const cached = getCached(url);
  if (cached) {
    res.set("X-Cache", "HIT");
    return res.json(cached);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      headers: UPSTREAM_HEADERS,
      signal: controller.signal,
    });
    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Swiggy sometimes answers with an HTML block page for blocked IPs.
      console.error(`Upstream returned non-JSON (HTTP ${upstream.status}) for ${url}`);
      return res.status(502).json({
        statusCode: 1,
        message: "Upstream did not return JSON (the request may have been blocked).",
        upstreamStatus: upstream.status,
      });
    }

    if (!upstream.ok) {
      console.error(`Upstream HTTP ${upstream.status} for ${url}`);
      return res.status(upstream.status >= 500 ? 502 : upstream.status).json({
        statusCode: 1,
        message: data?.message || "Upstream request failed.",
        upstreamStatus: upstream.status,
      });
    }

    setCached(url, data);
    res.set("X-Cache", "MISS");
    return res.json(data);
  } catch (err) {
    const timedOut = err.name === "AbortError";
    console.error(timedOut ? `Upstream timeout for ${url}` : err);
    return res.status(timedOut ? 504 : 502).json({
      statusCode: 1,
      message: timedOut ? "Upstream request timed out." : "Could not reach upstream.",
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---- routes ---------------------------------------------------------------

// Restaurant list:  /api/restaurants?lat=..&lng=..[&page_type=DESKTOP_WEB_LISTING]
app.get("/api/restaurants", (req, res) => {
  const lat = pick(req.query, "lat");
  const lng = pick(req.query, "lng");
  const pageType = pick(req.query, "page_type", "page-type") || "DESKTOP_WEB_LISTING";

  if (!isNum(lat) || !isNum(lng)) {
    return res
      .status(400)
      .json({ statusCode: 1, message: "lat and lng are required numbers." });
  }

  const qs = new URLSearchParams({ lat, lng, page_type: pageType });
  return proxy(res, `${SWIGGY_BASE}/restaurants/list/v5?${qs}`);
});

// Menu:  /api/menu?restaurantId=..&lat=..&lng=..
app.get("/api/menu", (req, res) => {
  const restaurantId = pick(req.query, "restaurantId");
  const lat = pick(req.query, "lat");
  const lng = pick(req.query, "lng");

  if (!/^\d+$/.test(String(restaurantId || ""))) {
    return res
      .status(400)
      .json({ statusCode: 1, message: "restaurantId is required and must be numeric." });
  }
  if (!isNum(lat) || !isNum(lng)) {
    return res
      .status(400)
      .json({ statusCode: 1, message: "lat and lng are required numbers." });
  }

  const qs = new URLSearchParams({
    "page-type": pick(req.query, "page-type", "page_type") || "REGULAR_MENU",
    "complete-menu": pick(req.query, "complete-menu", "complete_menu") || "true",
    lat,
    lng,
    submitAction: pick(req.query, "submitAction") || "ENTER",
    restaurantId,
  });
  return proxy(res, `${SWIGGY_BASE}/menu/pl?${qs}`);
});

app.get("/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get("/", (req, res) => {
  res.json({ test: "Welcome to FoodExpress! ", endpoints: ["/api/restaurants", "/api/menu", "/health"] });
});

// Unknown routes -> JSON 404 (instead of Express's HTML page)
app.use((req, res) => res.status(404).json({ statusCode: 1, message: "Not found" }));

// Last-resort error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ statusCode: 1, message: "Internal server error" });
});

// Vercel imports the app; locally / on Render we listen on a port.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server is listening on port ${PORT}`));
}

module.exports = app;
