// Run with: npm test
// Starts a fake "Swiggy" upstream and the real app, then checks the behaviour.
const http = require("http");
const assert = require("assert");

let lastUpstreamUrl = "";
const upstream = http.createServer((req, res) => {
  lastUpstreamUrl = req.url;
  if (req.url.includes("restaurantId=404")) {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<html>blocked</html>");
  }
  if (req.url.includes("restaurantId=999")) return; // never answers -> timeout
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ statusCode: 0, data: { echo: req.url } }));
});

(async () => {
  await new Promise((r) => upstream.listen(0, r));
  process.env.SWIGGY_BASE_URL = `http://127.0.0.1:${upstream.address().port}/dapi`;
  process.env.UPSTREAM_TIMEOUT_MS = "500";
  const app = require("./server");
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => {
    const r = await fetch(base + p);
    return { status: r.status, body: await r.json(), cache: r.headers.get("x-cache") };
  };

  // 1. The exact (odd) URL the React app sends: "?pl?page-type=..."
  let r = await get("/api/menu?pl?page-type=REGULAR_MENU&complete-menu=true&lat=28.61&lng=77.05&restaurantId=69262");
  assert.strictEqual(r.status, 200);
  assert.ok(lastUpstreamUrl.includes("page-type=REGULAR_MENU"), "page-type must be forwarded: " + lastUpstreamUrl);
  assert.ok(!lastUpstreamUrl.includes("undefined"), "no 'undefined' params: " + lastUpstreamUrl);
  assert.ok(lastUpstreamUrl.includes("submitAction=ENTER"));
  assert.ok(lastUpstreamUrl.includes("restaurantId=69262"));

  // 2. Clean URL works too, and a repeat is served from cache
  r = await get("/api/menu?page-type=REGULAR_MENU&lat=28.61&lng=77.05&restaurantId=69262");
  assert.strictEqual(r.status, 200);
  r = await get("/api/menu?page-type=REGULAR_MENU&lat=28.61&lng=77.05&restaurantId=69262");
  assert.strictEqual(r.cache, "HIT");

  // 3. Validation
  r = await get("/api/menu?lat=1&lng=2&restaurantId=abc");
  assert.strictEqual(r.status, 400);
  r = await get("/api/menu?restaurantId=1");
  assert.strictEqual(r.status, 400);
  r = await get("/api/restaurants?lat=x&lng=2");
  assert.strictEqual(r.status, 400);

  // 4. Restaurants list gets a default page_type
  r = await get("/api/restaurants?lat=16.3&lng=80.4");
  assert.strictEqual(r.status, 200);
  assert.ok(lastUpstreamUrl.includes("page_type=DESKTOP_WEB_LISTING"));

  // 5. Upstream HTML block page -> clean JSON error with statusCode 1 (frontend shows error screen)
  r = await get("/api/menu?lat=1&lng=2&restaurantId=404");
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.statusCode, 1);

  // 6. Upstream hangs -> 504
  r = await get("/api/menu?lat=1&lng=2&restaurantId=999");
  assert.strictEqual(r.status, 504);

  // 7. Misc
  assert.strictEqual((await get("/health")).body.ok, true);
  assert.strictEqual((await get("/nope")).status, 404);

  console.log("All server tests passed ✅");
  server.close();
  upstream.close();
  process.exit(0);
})().catch((e) => {
  console.error("TEST FAILED:", e.message);
  process.exit(1);
});
