"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { checkoutSuccessUrl, successPageUrl, deliveryOrigin } = require("../lib/delivery");

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_LIVE_SECRET_KEY",
  "STRIPE_RESTRICTED_KEY",
  "STRIPE_MODE",
  "DELIVERY_PUBLIC_ORIGIN",
  "CHECKOUT_ALLOWED_ORIGINS",
  "CHECKOUT_ALLOW_NO_ORIGIN",
];
const savedEnv = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
const originalFetch = global.fetch;

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  global.fetch = originalFetch;
});

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(payload) {
      this.body = payload || "";
    },
  };
}

function liveEnv(extra) {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.STRIPE_SECRET_KEY = "sk_live_dummy";
  process.env.STRIPE_MODE = "live";
  Object.assign(process.env, extra || {});
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "cs_live_789",
        url: "https://checkout.stripe.com/c/pay/cs_live_789",
        livemode: true,
        status: "open",
        payment_status: "unpaid",
        metadata: { a2a_listing_id: "lvl-x402-merchant-os" },
      }),
    };
  };
  return calls;
}

async function postCheckout(headers) {
  const handler = require("../api/index");
  const res = mockRes();
  await handler(
    {
      method: "POST",
      url: "/api/checkout",
      headers: { host: "agentic.lvlltd.com", origin: "https://agentic.lvlltd.com", ...headers },
      on(event, cb) {
        if (event === "data") cb(Buffer.from('{"a2a_listing_id":"lvl-x402-merchant-os"}'));
        if (event === "end") cb();
      },
    },
    res
  );
  return res;
}

test("success/cancel URLs point at agentic.lvlltd.com and never lvlltd.com", async () => {
  assert.equal(deliveryOrigin({}), "https://agentic.lvlltd.com");
  assert.equal(checkoutSuccessUrl({}), "https://agentic.lvlltd.com/buy/success?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(successPageUrl("cs_live_1", {}), "https://agentic.lvlltd.com/buy/success?session_id=cs_live_1");
  assert.equal(successPageUrl("", {}), null);
  const calls = liveEnv();
  const res = await postCheckout({});
  assert.equal(res.statusCode, 200, res.body);
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get("success_url"), "https://agentic.lvlltd.com/buy/success?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(form.get("cancel_url"), "https://agentic.lvlltd.com/buy?checkout=cancel&listing=lvl-x402-merchant-os");
  assert.doesNotMatch(calls[0].init.body, /\/\/lvlltd\.com/);
  assert.equal(JSON.parse(res.body).pack_download_url, "https://agentic.lvlltd.com/buy/success?session_id=cs_live_789");
});

test("success_url ignores spoofed Host / X-Forwarded-Host and honors DELIVERY_PUBLIC_ORIGIN", async () => {
  let calls = liveEnv();
  await postCheckout({ host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" });
  let form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get("success_url"), "https://agentic.lvlltd.com/buy/success?session_id={CHECKOUT_SESSION_ID}");
  assert.doesNotMatch(calls[0].init.body, /evil\.example/);

  calls = liveEnv({
    DELIVERY_PUBLIC_ORIGIN: "https://shop.example.com/",
    CHECKOUT_ALLOWED_ORIGINS: "https://shop.example.com",
  });
  const res = await postCheckout({ origin: "https://shop.example.com" });
  form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get("success_url"), "https://shop.example.com/buy/success?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(form.get("cancel_url"), "https://shop.example.com/buy?checkout=cancel&listing=lvl-x402-merchant-os");
  assert.equal(JSON.parse(res.body).pack_download_url, "https://shop.example.com/buy/success?session_id=cs_live_789");
});

test("GET /api/checkout/session returns pack_download_url for the storefront download page", async () => {
  liveEnv();
  const handler = require("../api/index");
  const res = mockRes();
  await handler(
    { method: "GET", url: "/api/checkout/session?session_id=cs_live_789", headers: { host: "agentic.lvlltd.com" } },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).pack_download_url, "https://agentic.lvlltd.com/buy/success?session_id=cs_live_789");
});

test("no served code still targets lvlltd.com/buy/success", () => {
  const root = path.join(__dirname, "..");
  for (const rel of [
    "api/stripe-test-checkout.js",
    "api/delivery.js",
    "lib/delivery.js",
    "lib/stripe-test-catalog.js",
    "public/stripe-test-buy.js",
    "public/buy.html",
    "stripe-test-buy.js",
    "buy.html",
  ]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, rel), "utf8"), /\/\/lvlltd\.com\/buy/, rel);
  }
});

// ---------- buy page fallback (legacy /buy?checkout=success return URL) ----------

async function runBuyPage(search, sessionPayload) {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "stripe-test-buy.js"), "utf8");
  const elements = {
    "sf-status": { hidden: true, textContent: "", className: "" },
    "sf-download": { hidden: true },
    "sf-download-link": { href: "/buy/success" },
  };
  const fetches = [];
  const context = {
    window: { location: { search, href: "" } },
    document: {
      readyState: "complete",
      getElementById: (id) => elements[id] || null,
      querySelectorAll: () => [],
    },
    URL,
    URLSearchParams,
    fetch: async (url) => {
      fetches.push(String(url));
      return { ok: true, json: async () => sessionPayload || {} };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { elements, fetches };
}

test("buy page: /buy?checkout=success links to the storefront download page", async () => {
  let page = await runBuyPage("?checkout=success&session_id=cs_live_old", {
    ok: true,
    livemode: true,
    checkout: { payment_status: "paid", livemode: true },
    pack_download_url: "https://agentic.lvlltd.com/buy/success?session_id=cs_live_old",
  });
  assert.equal(page.elements["sf-download"].hidden, false);
  assert.equal(page.elements["sf-download-link"].href, "https://agentic.lvlltd.com/buy/success?session_id=cs_live_old");
  assert.deepEqual(page.fetches, ["/api/checkout/session?session_id=cs_live_old"]);

  page = await runBuyPage("?checkout=success");
  assert.equal(page.elements["sf-download"].hidden, false);
  assert.equal(page.elements["sf-download-link"].href, "/buy/success");

  page = await runBuyPage("?checkout=cancel");
  assert.equal(page.elements["sf-download"].hidden, true);

  page = await runBuyPage("?checkout=success&session_id=cs_test_x", { livemode: false });
  assert.equal(page.elements["sf-download"].hidden, true);

  // A non-https pack_download_url is ignored; the same-origin fallback link stays.
  page = await runBuyPage("?checkout=success&session_id=cs_live_old", {
    ok: true,
    checkout: { payment_status: "paid" },
    pack_download_url: "javascript:alert(1)",
  });
  assert.equal(page.elements["sf-download-link"].href, "/buy/success?session_id=cs_live_old");
});
