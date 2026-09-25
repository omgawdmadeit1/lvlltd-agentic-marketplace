"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  sanitizeRef,
  sanitizeUtmValue,
  attributionFromInput,
  attributionMetadata,
  attributionFromSession,
} = require("../lib/attribution");

const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_LIVE_SECRET_KEY", "STRIPE_RESTRICTED_KEY", "STRIPE_MODE", "CHECKOUT_SUCCESS_URL"];
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

const BASE_METADATA = {
  rail: "a2a-marketplace",
  a2a_listing_id: "lvl-x402-merchant-os",
  price_id: "price_1UFmzKE9E4WCqx1QjoXF3BMO",
  mode: "live",
  trigger: "skillforge-agentic-buy",
};

/** POST /api/checkout with a mocked Stripe; returns the decoded form Stripe would receive. */
async function checkoutForm(body) {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.STRIPE_SECRET_KEY = "sk_live_dummy";
  process.env.STRIPE_MODE = "live";
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "cs_live_attr", url: "https://checkout.stripe.com/c/pay/cs_live_attr", livemode: true }),
    };
  };
  const handler = require("../api/index");
  const res = mockRes();
  await handler(
    {
      method: "POST",
      url: "/api/checkout",
      headers: { host: "agentic.lvlltd.com", origin: "https://agentic.lvlltd.com" },
      on(event, cb) {
        if (event === "data") cb(Buffer.from(JSON.stringify(body)));
        if (event === "end") cb();
      },
    },
    res
  );
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.stripe.com/v1/checkout/sessions");
  const params = new URLSearchParams(calls[0].init.body);
  const metadata = {};
  const piMetadata = {};
  for (const [key, value] of params) {
    const m = key.match(/^metadata\[(.+)\]$/);
    if (m) metadata[m[1]] = value;
    const pm = key.match(/^payment_intent_data\[metadata\]\[(.+)\]$/);
    if (pm) piMetadata[pm[1]] = value;
  }
  return { params, metadata, piMetadata };
}

// ---------- ref ----------

test("ref allowlist accepts ^[a-z0-9_-]{1,32}$ and silently drops everything else", () => {
  for (const ok of ["a", "partner_1", "x-promo-2026", "z".repeat(32)]) assert.equal(sanitizeRef(ok), ok);
  const bad = [
    "",
    "z".repeat(33),
    "Partner",
    "PROMO",
    "has space",
    " lead",
    "a.b",
    "a/b",
    "<script>",
    "x'); DROP TABLE--",
    "ref\n",
    "%61",
    "日本",
    123,
    null,
    undefined,
    ["abc"],
    { ref: "abc" },
    true,
  ];
  for (const value of bad) assert.equal(sanitizeRef(value), null, JSON.stringify(value));
});

test("checkout with a valid ref sets client_reference_id and metadata.ref, keeping existing metadata", async () => {
  const { params, metadata, piMetadata } = await checkoutForm({ a2a_listing_id: "lvl-x402-merchant-os", ref: "partner_1" });
  assert.equal(params.get("client_reference_id"), "partner_1");
  assert.deepEqual(metadata, { ...BASE_METADATA, ref: "partner_1" });
  assert.deepEqual(piMetadata, { ...BASE_METADATA, ref: "partner_1" });
  assert.equal(params.get("line_items[0][price]"), "price_1UFmzKE9E4WCqx1QjoXF3BMO");
});

test("invalid refs are dropped without error and leave the session unchanged", async () => {
  const bad = ["Partner", "z".repeat(33), "a b", "<img src=x>", "x'); DROP TABLE--", 42, ["partner"], { $ne: 1 }, null, ""];
  for (const ref of bad) {
    const { params, metadata } = await checkoutForm({ a2a_listing_id: "lvl-x402-merchant-os", ref });
    assert.equal(params.get("client_reference_id"), "lvl-x402-merchant-os", JSON.stringify(ref));
    assert.deepEqual(metadata, BASE_METADATA);
  }
});

test("absent ref and utm leave the Checkout request exactly as before", async () => {
  const { params, metadata, piMetadata } = await checkoutForm({ a2a_listing_id: "lvl-x402-merchant-os" });
  assert.equal(params.get("client_reference_id"), "lvl-x402-merchant-os");
  assert.deepEqual(metadata, BASE_METADATA);
  assert.deepEqual(piMetadata, BASE_METADATA);
});

// ---------- utm ----------

test("valid utm_* values are lowercased and copied into metadata alongside ref", async () => {
  const { params, metadata } = await checkoutForm({
    a2a_listing_id: "lvl-x402-merchant-os",
    ref: "partner_1",
    utm_source: "X",
    utm_medium: "social",
    utm_campaign: "Launch_Week-2026",
    utm_content: "  thread-1  ",
  });
  assert.equal(params.get("client_reference_id"), "partner_1");
  assert.deepEqual(metadata, {
    ...BASE_METADATA,
    ref: "partner_1",
    utm_source: "x",
    utm_medium: "social",
    utm_campaign: "launch_week-2026",
    utm_content: "thread-1",
  });
});

test("utm values use the ref allowlist: spaces, dots, specials or >32 chars are dropped, not truncated", async () => {
  assert.equal(sanitizeUtmValue("Newsletter"), "newsletter");
  assert.equal(sanitizeUtmValue("  CPC  "), "cpc");
  assert.equal(sanitizeUtmValue("a".repeat(32)), "a".repeat(32));
  for (const bad of ["a".repeat(33), "launch week", "x.com", "news\nletter", "<script>", "a/b", "", "   ", "日本", "\u0000cpc"]) {
    assert.equal(sanitizeUtmValue(bad), null, JSON.stringify(bad));
  }
  const { metadata } = await checkoutForm({
    a2a_listing_id: "lvl-x402-merchant-os",
    utm_campaign: "c".repeat(33),
    utm_source: "x.com",
    utm_medium: "Email",
  });
  assert.deepEqual(metadata, { ...BASE_METADATA, utm_medium: "email" });
});

test("non-string utm values and unknown keys are ignored (never a 400)", async () => {
  const { params, metadata } = await checkoutForm({
    a2a_listing_id: "lvl-x402-merchant-os",
    utm_source: 123,
    utm_medium: ["a"],
    utm_campaign: { $gt: "" },
    utm_content: "",
    utm_term: "not-whitelisted",
    utm_id: "nope",
    price: "0.01",
    rail: "attacker",
    metadata: { price_id: "price_evil" },
    client_reference_id: "spoof",
  });
  assert.equal(params.get("client_reference_id"), "lvl-x402-merchant-os");
  assert.deepEqual(metadata, BASE_METADATA);
});

test("attributionFromInput/attributionMetadata only emit whitelisted keys", () => {
  const attr = attributionFromInput({ ref: "abc", utm_source: " X ", utm_term: "t", foo: "bar" });
  assert.deepEqual(attr, { ref: "abc", utm: { utm_source: "x" } });
  assert.deepEqual(attributionMetadata(attr), { ref: "abc", utm_source: "x" });
  assert.deepEqual(attributionMetadata(attributionFromInput(null)), {});
  assert.deepEqual(attributionMetadata(attributionFromInput("ref=abc")), {});
});

// ---------- fulfillment record ----------

test("attributionFromSession re-validates ref/utm from a Stripe session for the fulfillment record", () => {
  assert.deepEqual(
    attributionFromSession({
      client_reference_id: "partner_1",
      metadata: { ...BASE_METADATA, ref: "partner_1", utm_source: "x", utm_term: "ignored" },
    }),
    { ref: "partner_1", utm_source: "x" }
  );
  // Falls back to client_reference_id when metadata.ref is missing.
  assert.deepEqual(attributionFromSession({ client_reference_id: "promo-7", metadata: {} }), { ref: "promo-7" });
  // Without a ref, client_reference_id is the listing id, which is not treated as a ref.
  assert.deepEqual(attributionFromSession({ client_reference_id: "lvl-x402-merchant-os", metadata: BASE_METADATA }), {
    ref: null,
  });
  // Tampered values are dropped.
  assert.deepEqual(
    attributionFromSession({ client_reference_id: "BAD REF", metadata: { ref: "<x>", utm_source: "a".repeat(200), utm_medium: "Email" } }),
    { ref: null, utm_medium: "email" }
  );
  assert.deepEqual(attributionFromSession(null), { ref: null });
});

// ---------- buy page ----------

function buyPageBody(search) {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "stripe-test-buy.js"), "utf8");
  let captured = null;
  const window = {
    location: { search, href: "" },
  };
  const context = {
    window,
    document: {
      readyState: "complete",
      getElementById: () => null,
      querySelectorAll: () => [],
    },
    URL,
    URLSearchParams,
    fetch: async (url, init) => {
      captured = { url, init };
      return { ok: true, json: async () => ({ ok: true, checkout: { url: "https://checkout.stripe.com/x" } }) };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return window.LVLStripeLiveBuy.startCheckout("lvl-x402-merchant-os", null).then(() => {
    assert.equal(captured.url, "/api/checkout");
    return JSON.parse(captured.init.body);
  });
}

test("buy page carries ?ref= and utm_* from the URL into the POST /api/checkout body", async () => {
  assert.deepEqual(await buyPageBody(""), { a2a_listing_id: "lvl-x402-merchant-os" });
  assert.deepEqual(
    await buyPageBody("?ref=partner_1&utm_source=x&utm_medium=social&utm_campaign=launch&utm_content=t1&utm_term=no"),
    {
      a2a_listing_id: "lvl-x402-merchant-os",
      ref: "partner_1",
      utm_source: "x",
      utm_medium: "social",
      utm_campaign: "launch",
      utm_content: "t1",
    }
  );
  // Invalid ref/utm dropped client-side too (checkout still proceeds); uppercase utm is lowercased.
  const body = await buyPageBody(`?ref=Partner%20One&utm_campaign=${"c".repeat(40)}&utm_source=X&utm_medium=e.mail`);
  assert.deepEqual(body, { a2a_listing_id: "lvl-x402-merchant-os", utm_source: "x" });
  const publicCopy = fs.readFileSync(path.join(__dirname, "..", "public", "stripe-test-buy.js"), "utf8");
  const rootCopy = fs.readFileSync(path.join(__dirname, "..", "stripe-test-buy.js"), "utf8");
  assert.equal(rootCopy, publicCopy);
});
