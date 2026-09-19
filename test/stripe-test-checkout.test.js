"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  TEST_LISTINGS,
  UNPROVEN_LIVE_PRICE_IDS,
  listingById,
  publicCatalog,
  resolveTestSecretKey,
  encodeStripeForm,
  checkoutMetadata,
} = require("../lib/stripe-test-catalog");
const { resolveListing } = require("../api/stripe-test-checkout");

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

test("catalog exposes only the two proven TEST price_ids", () => {
  const catalog = publicCatalog();
  assert.equal(catalog.mode, "test");
  assert.equal(catalog.livemode, false);
  assert.equal(catalog.listings.length, 2);
  assert.deepEqual(
    catalog.listings.map((item) => item.a2a_listing_id),
    ["lvl-x402-merchant-os", "lvl-cold-start-catalog-bootstrapper"]
  );
  assert.deepEqual(
    catalog.listings.map((item) => item.price_id),
    ["price_1UFmN9ERacEsZ559klrqrc7H", "price_1UFmNBERacEsZ559R01gpXx1"]
  );
  for (const listing of catalog.listings) {
    assert.equal(listing.amount_label, "$0.99 TEST");
    assert.equal(listing.livemode, false);
    assert.equal(listing.kind, "digital_good");
    assert.equal(listing.mode, "test");
  }
});

test("checkout metadata is the required rail payload", () => {
  const listing = listingById("lvl-x402-merchant-os");
  assert.deepEqual(checkoutMetadata(listing), {
    rail: "a2a-marketplace",
    a2a_listing_id: "lvl-x402-merchant-os",
    price_id: "price_1UFmN9ERacEsZ559klrqrc7H",
    mode: "test",
    trigger: "skillforge-agentic-buy",
  });
});

test("unproven LIVE price_ids are rejected", () => {
  for (const priceId of UNPROVEN_LIVE_PRICE_IDS) {
    const resolved = resolveListing({ price_id: priceId });
    assert.equal(resolved.error, "live_price_id_rejected");
  }
});

test("unknown listing ids are rejected", () => {
  const resolved = resolveListing({ a2a_listing_id: "skill_sniper" });
  assert.equal(resolved.error, "listing_not_in_test_catalog");
});

test("price mismatch against allowlist is rejected", () => {
  const resolved = resolveListing({
    a2a_listing_id: "lvl-x402-merchant-os",
    price_id: "price_1UFmNBERacEsZ559R01gpXx1",
  });
  assert.equal(resolved.error, "price_id_mismatch");
});

test("TEST secret resolver accepts test keys and rejects live keys", () => {
  assert.equal(resolveTestSecretKey({}).ok, false);
  assert.equal(resolveTestSecretKey({ STRIPE_SECRET_KEY: "sk_live_xxx" }).error, "live_key_rejected");
  assert.equal(resolveTestSecretKey({ STRIPE_SECRET_KEY: "rk_live_xxx" }).error, "live_key_rejected");
  assert.equal(resolveTestSecretKey({ STRIPE_SECRET_KEY: "not-a-key" }).error, "key_not_test_mode");
  const ok = resolveTestSecretKey({ STRIPE_SECRET_KEY: "sk_test_dummy" });
  assert.equal(ok.ok, true);
  assert.equal(ok.key, "sk_test_dummy");
});

test("form encoder nests Stripe metadata fields", () => {
  const encoded = encodeStripeForm({
    mode: "payment",
    metadata: { rail: "a2a-marketplace", mode: "test" },
    line_items: [{ price: TEST_LISTINGS[0].price_id, quantity: 1 }],
  });
  assert.match(encoded, /mode=payment/);
  assert.match(encoded, /metadata%5Brail%5D=a2a-marketplace/);
  assert.match(encoded, /line_items%5B0%5D%5Bprice%5D=price_1UFmN9ERacEsZ559klrqrc7H/);
});

test("GET /api/checkout returns TEST catalog and does not invent revenue", async () => {
  const handler = require("../api/index");
  const res = mockRes();
  await handler(
    { method: "GET", url: "/api/checkout", headers: { host: "agentic.lvlltd.com" } },
    res
  );
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.mode, "test");
  assert.equal(body.livemode, false);
  assert.match(body.honesty, /Not live revenue/);
  assert.equal(body.listings.length, 2);
});

test("POST /api/checkout without a TEST key stays 503 and leaks no secrets", async () => {
  const previous = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_TEST_SECRET_KEY;
  const handler = require("../api/index");
  const req = {
    method: "POST",
    url: "/api/checkout",
    headers: { host: "agentic.lvlltd.com" },
    on(event, cb) {
      if (event === "data") cb(Buffer.from('{"a2a_listing_id":"lvl-x402-merchant-os"}'));
      if (event === "end") cb();
    },
  };
  const res = mockRes();
  await handler(req, res);
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 503);
  assert.equal(body.mode, "test");
  assert.equal(body.livemode, false);
  assert.equal(body.error, "missing_stripe_test_key");
  assert.doesNotMatch(res.body, /sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]+/);
  if (previous) process.env.STRIPE_SECRET_KEY = previous;
});

test("POST /api/checkout creates a TEST session with required metadata", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "cs_test_123",
        url: "https://checkout.stripe.com/c/pay/cs_test_123",
        livemode: false,
        status: "open",
        payment_status: "unpaid",
        amount_total: 99,
        currency: "usd",
        metadata: {
          rail: "a2a-marketplace",
          a2a_listing_id: "lvl-cold-start-catalog-bootstrapper",
          price_id: "price_1UFmNBERacEsZ559R01gpXx1",
          mode: "test",
          trigger: "skillforge-agentic-buy",
        },
      }),
    };
  };
  const handler = require("../api/index");
  const req = {
    method: "POST",
    url: "/api/checkout",
    headers: { host: "agentic.lvlltd.com", "x-forwarded-proto": "https" },
    on(event, cb) {
      if (event === "data") {
        cb(Buffer.from('{"a2a_listing_id":"lvl-cold-start-catalog-bootstrapper"}'));
      }
      if (event === "end") cb();
    },
  };
  const res = mockRes();
  await handler(req, res);
  global.fetch = originalFetch;
  delete process.env.STRIPE_SECRET_KEY;
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.livemode, false);
  assert.equal(body.checkout.url, "https://checkout.stripe.com/c/pay/cs_test_123");
  assert.equal(body.checkout.metadata.rail, "a2a-marketplace");
  assert.equal(body.checkout.metadata.trigger, "skillforge-agentic-buy");
  assert.equal(body.listing.amount_label, "$0.99 TEST");
  assert.equal(captured.url, "https://api.stripe.com/v1/checkout/sessions");
  const form = captured.init.body;
  assert.match(form, /metadata%5Brail%5D=a2a-marketplace/);
  assert.match(form, /metadata%5Ba2a_listing_id%5D=lvl-cold-start-catalog-bootstrapper/);
  assert.match(form, /metadata%5Bprice_id%5D=price_1UFmNBERacEsZ559R01gpXx1/);
  assert.match(form, /metadata%5Bmode%5D=test/);
  assert.match(form, /metadata%5Btrigger%5D=skillforge-agentic-buy/);
  assert.match(form, /payment_intent_data%5Bmetadata%5D%5Brail%5D=a2a-marketplace/);
  assert.match(form, /line_items%5B0%5D%5Bprice%5D=price_1UFmNBERacEsZ559R01gpXx1/);
  assert.doesNotMatch(form, /payment_method_types/);
});

test("live Stripe sessions are not forwarded", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: "cs_live_nope",
      url: "https://checkout.stripe.com/c/pay/cs_live_nope",
      livemode: true,
    }),
  });
  const handler = require("../api/index");
  const req = {
    method: "POST",
    url: "/api/checkout",
    headers: { host: "agentic.lvlltd.com" },
    on(event, cb) {
      if (event === "data") cb(Buffer.from('{"a2a_listing_id":"lvl-x402-merchant-os"}'));
      if (event === "end") cb();
    },
  };
  const res = mockRes();
  await handler(req, res);
  global.fetch = originalFetch;
  delete process.env.STRIPE_SECRET_KEY;
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 409);
  assert.equal(body.error, "livemode_session_rejected");
  assert.equal(body.livemode, false);
});

test("existing market API still answers /api/health", async () => {
  const handler = require("../api/index");
  const res = mockRes();
  await handler(
    { method: "GET", url: "/api/health", headers: { host: "agentic.lvlltd.com" } },
    res
  );
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, true);
});
