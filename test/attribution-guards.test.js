"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { signStripePayload } = require("../lib/delivery");
const { clearPackCache } = require("../lib/delivery-packs");

const WHSEC = "whsec_unit_test_dummy_secret";
const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_LIVE_SECRET_KEY",
  "STRIPE_RESTRICTED_KEY",
  "STRIPE_MODE",
  "STRIPE_WEBHOOK_SECRET",
  "DELIVERY_SIGNING_SECRET",
  "DELIVERY_GITHUB_TOKEN",
  "DELIVERY_PUBLIC_ORIGIN",
  "RESEND_API_KEY",
  "DELIVERY_FROM_EMAIL",
  "CHECKOUT_ALLOWED_ORIGINS",
  "CHECKOUT_ALLOW_NO_ORIGIN",
];
const savedEnv = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
const originalFetch = global.fetch;
const originalLog = console.log;

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  global.fetch = originalFetch;
  console.log = originalLog;
  clearPackCache();
});

function setEnv(vars) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, vars);
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(payload) {
      this.body = payload === undefined ? "" : payload;
    },
  };
}

function postReq(headers, raw) {
  return {
    method: "POST",
    url: "/api/checkout",
    headers: { host: "agentic.lvlltd.com", ...headers },
    on(event, cb) {
      if (event === "data") cb(Buffer.from(raw));
      if (event === "end") cb();
    },
  };
}

function countingStripe() {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "cs_live_guard", url: "https://checkout.stripe.com/c/pay/cs_live_guard", livemode: true }),
    };
  };
  return calls;
}

const ATTR = {
  ref: "partner_1",
  utm_source: "x",
  utm_medium: "social",
  utm_campaign: "launch",
  utm_content: "thread-1",
};

// ---------- origin guard + 4 KB cap still apply with ref/utm ----------

test("origin guard still rejects ref/utm requests from the wrong or missing origin (no Stripe call)", async () => {
  setEnv({ STRIPE_SECRET_KEY: "sk_live_dummy", STRIPE_MODE: "live" });
  const calls = countingStripe();
  const handler = require("../api/index");
  const raw = JSON.stringify({ a2a_listing_id: "lvl-x402-merchant-os", ...ATTR });
  for (const headers of [
    { origin: "https://evil.example" },
    { referer: "https://evil.example/buy?ref=partner_1&utm_source=x" },
    { origin: "https://agentic.lvlltd.com.evil.example" },
    {},
  ]) {
    const res = mockRes();
    await handler(postReq(headers, raw), res);
    assert.equal(res.statusCode, 403, JSON.stringify(headers));
    assert.match(JSON.parse(res.body).error, /^origin_(not_allowed|required)$/);
  }
  assert.equal(calls.length, 0);

  // Allowed referer (the /buy?ref=... page itself) passes, and the ref is carried.
  const ok = mockRes();
  await handler(postReq({ referer: "https://agentic.lvlltd.com/buy?ref=partner_1&utm_source=x" }, raw), ok);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(calls.length, 1);
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get("client_reference_id"), "partner_1");
  assert.equal(form.get("metadata[utm_source]"), "x");
});

test("4 KB body cap still applies when the body carries ref/utm (no Stripe call)", async () => {
  setEnv({ STRIPE_SECRET_KEY: "sk_live_dummy", STRIPE_MODE: "live" });
  const calls = countingStripe();
  const handler = require("../api/index");
  const origin = { origin: "https://agentic.lvlltd.com" };

  const oversized = JSON.stringify({
    a2a_listing_id: "lvl-x402-merchant-os",
    ...ATTR,
    utm_content: "a".repeat(4096),
  });
  assert.ok(Buffer.byteLength(oversized) > 4096);
  const res = mockRes();
  await handler(postReq(origin, oversized), res);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, "body_too_large");
  assert.equal(calls.length, 0);

  // A maximal valid attribution body (32-char ref + four 32-char utm values) stays far under the cap.
  const maximal = JSON.stringify({
    a2a_listing_id: "lvl-x402-merchant-os",
    ref: "r".repeat(32),
    utm_source: "s".repeat(32),
    utm_medium: "m".repeat(32),
    utm_campaign: "c".repeat(32),
    utm_content: "t".repeat(32),
  });
  assert.ok(Buffer.byteLength(maximal) < 512);
  const ok = mockRes();
  await handler(postReq(origin, maximal), ok);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(calls.length, 1);
});

// ---------- webhook: attribution is logged, display only ----------

function paidSession(overrides) {
  return {
    id: "cs_live_abc123",
    object: "checkout.session",
    livemode: true,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    client_reference_id: "lvl-x402-merchant-os",
    customer_details: { email: "buyer@example.com" },
    metadata: {
      rail: "a2a-marketplace",
      a2a_listing_id: "lvl-x402-merchant-os",
      sku: "lvl-x402-merchant-os",
      price_id: "price_1UFmzKE9E4WCqx1QjoXF3BMO",
      mode: "live",
      trigger: "skillforge-agentic-buy",
    },
    line_items: { object: "list", data: [{ price: { id: "price_1UFmzKE9E4WCqx1QjoXF3BMO" } }] },
    payment_intent: {
      id: "pi_live_1",
      object: "payment_intent",
      status: "succeeded",
      metadata: {},
      latest_charge: { id: "ch_live_1", paid: true, status: "succeeded", refunded: false, amount_refunded: 0, disputed: false },
    },
    ...overrides,
  };
}

async function runWebhook(session) {
  setEnv({
    STRIPE_WEBHOOK_SECRET: WHSEC,
    DELIVERY_SIGNING_SECRET: "delivery-signing-secret-for-unit-tests-0123456789",
    STRIPE_SECRET_KEY: "sk_live_dummy",
    STRIPE_MODE: "live",
  });
  const logs = [];
  console.log = (line) => logs.push(JSON.parse(line));
  global.fetch = async (url) => {
    if (String(url).startsWith("https://api.stripe.com/v1/checkout/sessions/")) {
      return { ok: true, status: 200, json: async () => session };
    }
    throw new Error("unexpected fetch " + url);
  };
  const raw = JSON.stringify({ id: "evt_attr", type: "checkout.session.completed", livemode: true, data: { object: { id: session.id } } });
  const req = {
    method: "POST",
    url: "/api/stripe/webhook",
    headers: { host: "agentic.lvlltd.com", "stripe-signature": signStripePayload(raw, WHSEC) },
    on(event, cb) {
      if (event === "data") cb(Buffer.from(raw));
      if (event === "end") cb();
    },
  };
  const res = mockRes();
  await require("../api/index")(req, res);
  const record = logs.find((entry) => entry.at === "agentic_delivery" && entry.event === "evt_attr");
  return { res, body: JSON.parse(res.body), record };
}

test("webhook log / fulfillment record carries re-validated ref + utm_*", async () => {
  const session = paidSession({
    client_reference_id: "partner_1",
    metadata: { ...paidSession().metadata, ref: "partner_1", utm_source: "x", utm_campaign: "launch" },
  });
  const { res, body, record } = await runWebhook(session);
  assert.equal(res.statusCode, 200);
  assert.equal(body.deliverable, true);
  assert.deepEqual(record.attribution, { ref: "partner_1", utm_source: "x", utm_campaign: "launch" });
  assert.equal(record.session, "cs_live_abc123");
  assert.equal(record.deliverable, true);
  // Display only: never echoed in the webhook response.
  assert.equal(body.attribution, undefined);
  assert.doesNotMatch(res.body, /partner_1/);
});

test("attribution never affects delivery: same decision with, without, or with hostile values", async () => {
  const base = await runWebhook(paidSession());
  assert.deepEqual(base.record.attribution, { ref: null });

  const hostile = await runWebhook(
    paidSession({
      client_reference_id: "BAD REF",
      metadata: { ...paidSession().metadata, ref: "<script>", utm_source: "a".repeat(200), utm_medium: "Email" },
    })
  );
  assert.deepEqual(hostile.record.attribution, { ref: null, utm_medium: "email" });
  const strip = ({ attribution, ...rest }) => rest;
  assert.deepEqual(strip(hostile.record), strip(base.record));
  assert.deepEqual(hostile.body, base.body);

  // A valid ref on an unpaid session is logged but still never delivers.
  const unpaid = await runWebhook(
    paidSession({ payment_status: "unpaid", metadata: { ...paidSession().metadata, ref: "partner_1" } })
  );
  assert.equal(unpaid.body.deliverable, false);
  assert.equal(unpaid.body.reason, "not_paid");
  assert.deepEqual(unpaid.record.attribution, { ref: "partner_1" });
});
