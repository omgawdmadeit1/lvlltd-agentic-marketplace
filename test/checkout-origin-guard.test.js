"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { checkRequestOrigin, allowedOrigins } = require("../api/stripe-test-checkout");

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_LIVE_SECRET_KEY",
  "STRIPE_RESTRICTED_KEY",
  "STRIPE_MODE",
  "CHECKOUT_ALLOWED_ORIGINS",
  "CHECKOUT_ALLOW_NO_ORIGIN",
  "VERCEL",
  "NODE_ENV",
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

function postReq(headers, rawBody) {
  return {
    method: "POST",
    url: "/api/checkout",
    headers: { host: "agentic.lvlltd.com", ...headers },
    on(event, cb) {
      if (event === "data" && rawBody !== undefined) cb(Buffer.from(rawBody));
      if (event === "end") cb();
    },
  };
}

const GOOD_BODY = '{"a2a_listing_id":"lvl-x402-merchant-os"}';

/** Live env + Stripe mock that records every call. */
function liveStripe(env) {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.STRIPE_SECRET_KEY = "sk_live_dummy";
  process.env.STRIPE_MODE = "live";
  process.env.VERCEL = "1"; // behave like production on Vercel (no localhost allowance)
  Object.assign(process.env, env || {});
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "cs_live_guard",
        url: "https://checkout.stripe.com/c/pay/cs_live_guard",
        livemode: true,
        status: "open",
        payment_status: "unpaid",
      }),
    };
  };
  return calls;
}

async function post(headers, rawBody) {
  const handler = require("../api/index");
  const res = mockRes();
  await handler(postReq(headers, rawBody), res);
  return { res, body: JSON.parse(res.body) };
}

test("allowed Origin creates a session", async () => {
  const calls = liveStripe();
  const { res, body } = await post({ origin: "https://agentic.lvlltd.com" }, GOOD_BODY);
  assert.equal(res.statusCode, 200);
  assert.equal(body.checkout.id, "cs_live_guard");
  assert.equal(calls.length, 1);
});

test("wrong Origin is 403 and Stripe is never called", async () => {
  const calls = liveStripe();
  for (const origin of ["https://evil.example", "http://agentic.lvlltd.com", "null", "https://agentic.lvlltd.com.evil.example"]) {
    const { res, body } = await post({ origin }, GOOD_BODY);
    assert.equal(res.statusCode, 403, origin);
    assert.equal(body.error, "origin_not_allowed");
  }
  assert.equal(calls.length, 0);
});

test("Origin wins over Referer: bad Origin + good Referer is still 403", async () => {
  const calls = liveStripe();
  const { res } = await post(
    { origin: "https://evil.example", referer: "https://agentic.lvlltd.com/buy" },
    GOOD_BODY
  );
  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0);
});

test("Referer fallback: allowed Referer passes, foreign Referer is 403", async () => {
  const calls = liveStripe();
  const ok = await post({ referer: "https://agentic.lvlltd.com/buy?x=1" }, GOOD_BODY);
  assert.equal(ok.res.statusCode, 200);
  assert.equal(calls.length, 1);
  const bad = await post({ referer: "https://evil.example/agentic.lvlltd.com" }, GOOD_BODY);
  assert.equal(bad.res.statusCode, 403);
  assert.equal(bad.body.error, "origin_not_allowed");
  assert.equal(calls.length, 1);
});

test("no Origin/Referer is 403 by default and passes only with CHECKOUT_ALLOW_NO_ORIGIN=1", async () => {
  let calls = liveStripe();
  const blocked = await post({}, GOOD_BODY);
  assert.equal(blocked.res.statusCode, 403);
  assert.equal(blocked.body.error, "origin_required");
  assert.equal(calls.length, 0);

  calls = liveStripe({ CHECKOUT_ALLOW_NO_ORIGIN: "0" });
  assert.equal((await post({}, GOOD_BODY)).res.statusCode, 403);
  assert.equal(calls.length, 0);

  calls = liveStripe({ CHECKOUT_ALLOW_NO_ORIGIN: "1" });
  const allowed = await post({}, GOOD_BODY);
  assert.equal(allowed.res.statusCode, 200);
  assert.equal(calls.length, 1);
  // The opt-in does not let a foreign browser Origin through.
  assert.equal((await post({ origin: "https://evil.example" }, GOOD_BODY)).res.statusCode, 403);
  assert.equal(calls.length, 1);
});

test("CHECKOUT_ALLOWED_ORIGINS replaces the default allowlist", async () => {
  const calls = liveStripe({ CHECKOUT_ALLOWED_ORIGINS: "https://agentic.lvlltd.com, https://preview.lvlltd.com/" });
  assert.deepEqual(allowedOrigins(process.env), ["https://agentic.lvlltd.com", "https://preview.lvlltd.com"]);
  assert.equal((await post({ origin: "https://preview.lvlltd.com" }, GOOD_BODY)).res.statusCode, 200);
  assert.equal((await post({ origin: "https://other.lvlltd.com" }, GOOD_BODY)).res.statusCode, 403);
  assert.equal(calls.length, 1);
  assert.deepEqual(allowedOrigins({ CHECKOUT_ALLOWED_ORIGINS: " , not a url" }), ["https://agentic.lvlltd.com"]);
});

test("localhost is allowed only for local dev, never on Vercel/production", () => {
  const req = { headers: { origin: "http://127.0.0.1:4173" } };
  assert.equal(checkRequestOrigin(req, {}).ok, true);
  assert.equal(checkRequestOrigin({ headers: { origin: "http://localhost:4173" } }, {}).ok, true);
  assert.equal(checkRequestOrigin(req, { VERCEL: "1" }).ok, false);
  assert.equal(checkRequestOrigin(req, { NODE_ENV: "production" }).ok, false);
});

test("malformed, unknown, missing ids and empty/invalid bodies are 400 with no Stripe call", async () => {
  const calls = liveStripe();
  const origin = { origin: "https://agentic.lvlltd.com" };
  const cases = [
    [undefined, "body_required"],
    ["", "body_required"],
    ["   ", "body_required"],
    ["not json", "invalid_json"],
    ["[]", "body_not_object"],
    ['"lvl-x402-merchant-os"', "body_not_object"],
    ["null", "body_not_object"],
    ["{}", "listing_required"],
    ['{"a2a_listing_id":""}', "listing_required"],
    ['{"a2a_listing_id":123}', "invalid_listing_id"],
    ['{"a2a_listing_id":["lvl-x402-merchant-os"]}', "invalid_listing_id"],
    ['{"a2a_listing_id":"LVL-X402-MERCHANT-OS"}', "invalid_listing_id"],
    ['{"a2a_listing_id":" lvl-x402-merchant-os"}', "invalid_listing_id"],
    ['{"a2a_listing_id":"lvl_x402"}', "invalid_listing_id"],
    ['{"a2a_listing_id":"ab"}', "invalid_listing_id"],
    [JSON.stringify({ a2a_listing_id: "a".repeat(65) }), "invalid_listing_id"],
    ['{"a2a_listing_id":"../etc/passwd"}', "invalid_listing_id"],
    ['{"a2a_listing_id":"lvl-unknown-pack"}', "listing_not_in_live_catalog"],
    ['{"price_id":"price_1UFmzKE9E4WCqx1QjoXF3BMO"}', "listing_required"],
    ['{"a2a_listing_id":"lvl-x402-merchant-os","price_id":{"$ne":1}}', "invalid_price_id"],
    [JSON.stringify({ a2a_listing_id: "lvl-x402-merchant-os", pad: "x".repeat(5000) }), "body_too_large"],
  ];
  for (const [raw, error] of cases) {
    const { res, body } = await post(origin, raw);
    assert.equal(res.statusCode, 400, `${raw} -> ${res.body}`);
    assert.equal(body.error, error, String(raw));
  }
  assert.equal(calls.length, 0);
});
