"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const {
  verifyStripeSignature,
  signStripePayload,
  signDownloadToken,
  verifyDownloadToken,
  linkTtlSeconds,
  assessDeliverability,
  buildZip,
  crc32,
} = require("../lib/delivery");
const {
  PACK_FILES,
  PACK_SOURCE,
  DELIVERY_PACKS,
  packContentSha256,
  clearPackCache,
} = require("../lib/delivery-packs");

const WHSEC = "whsec_unit_test_dummy_secret";
const SIGNING = "delivery-signing-secret-for-unit-tests-0123456789";
const ENV_KEYS = [
  "STRIPE_WEBHOOK_SECRET",
  "DELIVERY_SIGNING_SECRET",
  "DELIVERY_LINK_TTL_HOURS",
  "STRIPE_SECRET_KEY",
  "STRIPE_LIVE_SECRET_KEY",
  "STRIPE_RESTRICTED_KEY",
  "STRIPE_MODE",
  "DELIVERY_GITHUB_TOKEN",
  "RESEND_API_KEY",
  "DELIVERY_FROM_EMAIL",
  "DELIVERY_PUBLIC_ORIGIN",
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
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  console.log = () => {};
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(payload) {
      this.body = payload === undefined ? "" : payload;
    },
  };
}

function webhookReq(raw, signature) {
  const headers = { host: "agentic.lvlltd.com" };
  if (signature) headers["stripe-signature"] = signature;
  return {
    method: "POST",
    url: "/api/stripe/webhook",
    headers,
    on(event, cb) {
      if (event === "data") cb(Buffer.from(raw));
      if (event === "end") cb();
    },
  };
}

function getReq(url) {
  return { method: "GET", url, headers: { host: "agentic.lvlltd.com" }, on() {} };
}

function paidSession(parts) {
  const p = parts || {};
  const charge = {
    id: "ch_live_1",
    object: "charge",
    paid: true,
    status: "succeeded",
    refunded: false,
    amount_refunded: 0,
    disputed: false,
    ...(p.charge || {}),
  };
  const paymentIntent = {
    id: "pi_live_1",
    object: "payment_intent",
    status: "succeeded",
    metadata: {},
    latest_charge: charge,
    ...(p.pi || {}),
  };
  return {
    id: "cs_live_abc123",
    object: "checkout.session",
    livemode: true,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
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
    payment_intent: paymentIntent,
    ...(p.session || {}),
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Mock Stripe (session lookup), Resend, and GitHub (pack source returns tampered bytes). */
function mockNetwork(session) {
  const calls = [];
  global.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init || {} });
    if (url.startsWith("https://api.stripe.com/v1/checkout/sessions/")) return jsonResponse(200, session);
    if (url.startsWith("https://api.stripe.com/v1/checkout/sessions?")) {
      return jsonResponse(200, { object: "list", data: [{ id: session.id }] });
    }
    if (url.startsWith("https://api.stripe.com/v1/payment_intents/")) return jsonResponse(200, { id: "pi_live_1" });
    if (url === "https://api.resend.com/emails") return jsonResponse(200, { id: "email_1" });
    if (url.startsWith("https://api.github.com/")) {
      return { ok: true, status: 200, text: async () => "tampered pack content" };
    }
    return jsonResponse(404, {});
  };
  return calls;
}

const LIVE_ENV = {
  STRIPE_WEBHOOK_SECRET: WHSEC,
  DELIVERY_SIGNING_SECRET: SIGNING,
  STRIPE_SECRET_KEY: "sk_live_dummy",
  STRIPE_MODE: "live",
};

function freshToken(sku) {
  return signDownloadToken(
    {
      sessionId: "cs_live_abc123",
      sku: sku || "lvl-x402-merchant-os",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
    SIGNING
  );
}

// ---------- Stripe signature ----------

test("webhook signature: valid Stripe-Signature verifies against raw body", () => {
  const raw = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const now = 1800000000;
  const header = signStripePayload(raw, WHSEC, now);
  const result = verifyStripeSignature(Buffer.from(raw), header, WHSEC, { nowSeconds: now + 10 });
  assert.equal(result.ok, true);
  assert.equal(result.event.id, "evt_1");
});

test("webhook signature: wrong secret, tampered body, missing or malformed header are rejected", () => {
  const raw = JSON.stringify({ id: "evt_1" });
  const now = 1800000000;
  const header = signStripePayload(raw, WHSEC, now);
  const opts = { nowSeconds: now };
  assert.equal(verifyStripeSignature(raw, header, "whsec_other", opts).error, "signature_mismatch");
  assert.equal(verifyStripeSignature(raw + " ", header, WHSEC, opts).error, "signature_mismatch");
  assert.equal(verifyStripeSignature(raw, undefined, WHSEC, opts).error, "signature_missing");
  assert.equal(verifyStripeSignature(raw, "garbage", WHSEC, opts).error, "signature_malformed");
  assert.equal(verifyStripeSignature(raw, header, "", opts).error, "webhook_secret_missing");
});

test("webhook signature: stale or future timestamps outside 5 minutes are rejected", () => {
  const raw = JSON.stringify({ id: "evt_1" });
  const now = 1800000000;
  assert.equal(
    verifyStripeSignature(raw, signStripePayload(raw, WHSEC, now - 301), WHSEC, { nowSeconds: now }).error,
    "signature_stale"
  );
  assert.equal(
    verifyStripeSignature(raw, signStripePayload(raw, WHSEC, now + 301), WHSEC, { nowSeconds: now }).error,
    "signature_stale"
  );
  assert.equal(
    verifyStripeSignature(raw, signStripePayload(raw, WHSEC, now - 299), WHSEC, { nowSeconds: now }).ok,
    true
  );
});

test("webhook signature: any matching v1 passes (secret rotation)", () => {
  const raw = JSON.stringify({ id: "evt_2" });
  const now = 1800000000;
  const good = signStripePayload(raw, WHSEC, now).split("v1=")[1];
  const header = `t=${now},v1=${"0".repeat(64)},v1=${good}`;
  assert.equal(verifyStripeSignature(raw, header, WHSEC, { nowSeconds: now }).ok, true);
});

test("POST /api/stripe/webhook fails closed with 503 when STRIPE_WEBHOOK_SECRET is missing", async () => {
  setEnv({ STRIPE_SECRET_KEY: "sk_live_dummy" });
  const calls = mockNetwork(paidSession());
  const handler = require("../api/index");
  const res = mockRes();
  await handler(webhookReq("{}", "t=1,v1=abc"), res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, "webhook_secret_missing");
  assert.equal(calls.length, 0);
});

test("POST /api/stripe/webhook rejects bad signatures with 400 and never calls Stripe", async () => {
  setEnv({ ...LIVE_ENV, RESEND_API_KEY: "re_dummy", DELIVERY_FROM_EMAIL: "orders@example.com" });
  const calls = mockNetwork(paidSession());
  const handler = require("../api/index");
  const raw = JSON.stringify({
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_live_abc123" } },
  });
  const res = mockRes();
  await handler(webhookReq(raw, signStripePayload(raw, "whsec_attacker")), res);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, "signature_mismatch");
  const stale = mockRes();
  const old = Math.floor(Date.now() / 1000) - 600;
  await handler(webhookReq(raw, signStripePayload(raw, WHSEC, old)), stale);
  assert.equal(stale.statusCode, 400);
  assert.equal(JSON.parse(stale.body).error, "signature_stale");
  assert.equal(calls.length, 0);
});

// ---------- download tokens ----------

test("download token: sign/verify round-trip binds session id + sku + expiry", () => {
  const exp = 2000000000;
  const token = signDownloadToken({ sessionId: "cs_live_abc123", sku: "lvl-x402-merchant-os", expiresAt: exp }, SIGNING);
  assert.deepEqual(verifyDownloadToken(token, SIGNING, exp - 60), {
    ok: true,
    sessionId: "cs_live_abc123",
    sku: "lvl-x402-merchant-os",
    expiresAt: exp,
  });
});

test("download token: expired, forged, wrong secret, unknown sku and malformed are rejected", () => {
  const exp = 2000000000;
  const token = signDownloadToken({ sessionId: "cs_live_abc123", sku: "lvl-x402-merchant-os", expiresAt: exp }, SIGNING);
  assert.equal(verifyDownloadToken(token, SIGNING, exp).error, "token_expired");
  assert.equal(verifyDownloadToken(token, SIGNING, exp + 1).error, "token_expired");
  const mac = token.split(".")[1];
  const forgedPayload = Buffer.from(
    JSON.stringify({ v: 1, sid: "cs_live_someone_else", sku: "lvl-x402-merchant-os", exp })
  ).toString("base64url");
  assert.equal(verifyDownloadToken(`${forgedPayload}.${mac}`, SIGNING, exp - 60).error, "token_invalid");
  assert.equal(
    verifyDownloadToken(token, "another-secret-that-is-long-enough-000000", exp - 60).error,
    "token_invalid"
  );
  const unknown = signDownloadToken({ sessionId: "cs_live_abc123", sku: "skill_sniper", expiresAt: exp }, SIGNING);
  assert.equal(verifyDownloadToken(unknown, SIGNING, exp - 60).error, "token_unknown_sku");
  assert.equal(verifyDownloadToken("garbage", SIGNING, exp - 60).error, "token_malformed");
  assert.equal(verifyDownloadToken(token, null, exp - 60).error, "signing_secret_missing");
});

test("download link TTL defaults to 72h and is clamped to 168h", () => {
  assert.equal(linkTtlSeconds({}), 72 * 3600);
  assert.equal(linkTtlSeconds({ DELIVERY_LINK_TTL_HOURS: "24" }), 24 * 3600);
  assert.equal(linkTtlSeconds({ DELIVERY_LINK_TTL_HOURS: "9999" }), 168 * 3600);
  assert.equal(linkTtlSeconds({ DELIVERY_LINK_TTL_HOURS: "-1" }), 72 * 3600);
  assert.equal(linkTtlSeconds({ DELIVERY_LINK_TTL_HOURS: "abc" }), 72 * 3600);
});

// ---------- deliverability ----------

test("deliverability: only a paid, unrefunded, undisputed LIVE session delivers", () => {
  const ok = assessDeliverability(paidSession());
  assert.equal(ok.ok, true);
  assert.equal(ok.sku, "lvl-x402-merchant-os");
  assert.equal(ok.email, "buyer@example.com");
  const cases = [
    [paidSession({ session: { payment_status: "unpaid" } }), "not_paid"],
    [paidSession({ session: { status: "open", payment_status: "unpaid" } }), "session_not_complete"],
    [paidSession({ session: { livemode: false } }), "not_livemode"],
    [paidSession({ pi: { status: "processing" } }), "payment_not_succeeded"],
    [paidSession({ pi: { latest_charge: null } }), "charge_missing"],
    [paidSession({ charge: { refunded: true, amount_refunded: 99 } }), "refunded"],
    [paidSession({ charge: { amount_refunded: 50 } }), "refunded"],
    [paidSession({ charge: { disputed: true } }), "disputed"],
    [paidSession({ charge: { paid: false, status: "failed" } }), "charge_not_succeeded"],
    [
      paidSession({
        session: { line_items: { data: [{ price: { id: "price_1UFmzME9E4WCqx1QkzHC4R5h" } }] } },
      }),
      "sku_not_deliverable",
    ],
    [paidSession({ session: { metadata: {}, line_items: { data: [] } } }), "sku_not_deliverable"],
  ];
  for (const [session, reason] of cases) {
    const result = assessDeliverability(session);
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason);
  }
});

// ---------- GET /api/download ----------

test("GET /api/download: unpaid, refunded and disputed sessions get 403 and the pack is never fetched", async () => {
  const handler = require("../api/index");
  const variants = [
    [paidSession({ session: { payment_status: "unpaid" } }), "not_paid"],
    [paidSession({ charge: { refunded: true, amount_refunded: 99 } }), "refunded"],
    [paidSession({ charge: { disputed: true } }), "disputed"],
    [paidSession({ pi: { status: "requires_payment_method" } }), "payment_not_succeeded"],
  ];
  for (const [session, reason] of variants) {
    setEnv({ ...LIVE_ENV, DELIVERY_GITHUB_TOKEN: "ghp_dummy" });
    const calls = mockNetwork(session);
    const res = mockRes();
    await handler(getReq(`/api/download?token=${encodeURIComponent(freshToken())}`), res);
    assert.equal(res.statusCode, 403, reason);
    assert.equal(JSON.parse(res.body).reason, reason);
    assert.ok(calls[0].url.includes("expand[]=payment_intent.latest_charge"));
    assert.equal(calls.some((call) => call.url.includes("api.github.com")), false);
  }
});

test("GET /api/download: expired or forged tokens never reach Stripe", async () => {
  setEnv({ ...LIVE_ENV, DELIVERY_GITHUB_TOKEN: "ghp_dummy" });
  const calls = mockNetwork(paidSession());
  const handler = require("../api/index");
  const expired = signDownloadToken(
    { sessionId: "cs_live_abc123", sku: "lvl-x402-merchant-os", expiresAt: Math.floor(Date.now() / 1000) - 1 },
    SIGNING
  );
  const res = mockRes();
  await handler(getReq(`/api/download?token=${encodeURIComponent(expired)}`), res);
  assert.equal(res.statusCode, 410);
  const forged = mockRes();
  await handler(getReq(`/api/download?token=${encodeURIComponent(freshToken())}x`), forged);
  assert.equal(forged.statusCode, 403);
  assert.equal(calls.length, 0);
});

test("GET /api/download fails closed with 503 when DELIVERY_SIGNING_SECRET is missing", async () => {
  setEnv({ STRIPE_SECRET_KEY: "sk_live_dummy", DELIVERY_GITHUB_TOKEN: "ghp_dummy" });
  const calls = mockNetwork(paidSession());
  const handler = require("../api/index");
  const res = mockRes();
  await handler(getReq(`/api/download?token=${encodeURIComponent(freshToken())}`), res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, "signing_secret_missing");
  assert.equal(calls.length, 0);
});

test("GET /api/download: paid session but pack bytes not matching the pinned sha256 are refused", async () => {
  setEnv({ ...LIVE_ENV, DELIVERY_GITHUB_TOKEN: "ghp_dummy" });
  const calls = mockNetwork(paidSession());
  const handler = require("../api/index");
  const res = mockRes();
  await handler(getReq(`/api/download?token=${encodeURIComponent(freshToken())}`), res);
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).error, "pack_hash_mismatch");
  const gh = calls.filter((call) => call.url.startsWith("https://api.github.com/"));
  assert.equal(gh.length, PACK_FILES.length);
  for (const call of gh) {
    assert.ok(call.url.includes(`ref=${PACK_SOURCE.commit}`));
    assert.ok(call.url.includes("/contents/goods/sealed/x402-merchant-operating-system/"));
    assert.equal(call.init.headers.Authorization, "Bearer ghp_dummy");
  }
});

test("GET /api/download: paid session without DELIVERY_GITHUB_TOKEN is 503, not a fake pack", async () => {
  setEnv({ ...LIVE_ENV });
  mockNetwork(paidSession());
  const handler = require("../api/index");
  const res = mockRes();
  await handler(getReq(`/api/download?token=${encodeURIComponent(freshToken())}`), res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, "pack_source_unconfigured");
});

test("GET /api/download: token sku must match the sku Stripe actually charged", async () => {
  setEnv({ ...LIVE_ENV, DELIVERY_GITHUB_TOKEN: "ghp_dummy" });
  const calls = mockNetwork(paidSession());
  const handler = require("../api/index");
  const res = mockRes();
  const token = freshToken("lvl-cold-start-catalog-bootstrapper");
  await handler(getReq(`/api/download?token=${encodeURIComponent(token)}`), res);
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, "sku_mismatch");
  assert.equal(calls.some((call) => call.url.includes("api.github.com")), false);
});

// ---------- webhook delivery ----------

function signedEvent(type, object) {
  const raw = JSON.stringify({ id: "evt_test", type, livemode: true, data: { object } });
  return webhookReq(raw, signStripePayload(raw, WHSEC));
}

test("webhook: checkout.session.completed for an unpaid session does not deliver or email", async () => {
  setEnv({ ...LIVE_ENV, RESEND_API_KEY: "re_dummy", DELIVERY_FROM_EMAIL: "orders@example.com" });
  const calls = mockNetwork(paidSession({ session: { payment_status: "unpaid" } }));
  const handler = require("../api/index");
  const res = mockRes();
  await handler(signedEvent("checkout.session.completed", { id: "cs_live_abc123" }), res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.deliverable, false);
  assert.equal(body.reason, "not_paid");
  assert.equal(calls.some((call) => call.url.includes("resend")), false);
});

test("webhook: refunded/disputed/failed events never deliver and never call Stripe or email", async () => {
  const handler = require("../api/index");
  const types = [
    "charge.refunded",
    "charge.dispute.created",
    "payment_intent.payment_failed",
    "checkout.session.async_payment_failed",
  ];
  for (const type of types) {
    setEnv({ ...LIVE_ENV, RESEND_API_KEY: "re_dummy", DELIVERY_FROM_EMAIL: "orders@example.com" });
    const calls = mockNetwork(paidSession());
    const res = mockRes();
    await handler(signedEvent(type, { id: "ch_live_1" }), res);
    assert.equal(res.statusCode, 200, type);
    const body = JSON.parse(res.body);
    assert.equal(body.deliverable, false);
    assert.equal(body.reason, "no_delivery_event");
    assert.equal(calls.length, 0);
  }
});

test("webhook: paid session emails a signed link (no attachment) and marks the PaymentIntent", async () => {
  setEnv({ ...LIVE_ENV, RESEND_API_KEY: "re_dummy", DELIVERY_FROM_EMAIL: "orders@example.com" });
  const calls = mockNetwork(paidSession());
  const handler = require("../api/index");
  const res = mockRes();
  await handler(signedEvent("checkout.session.completed", { id: "cs_live_abc123" }), res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.deliverable, true);
  assert.equal(body.emailed, true);
  assert.doesNotMatch(res.body, /token=/);
  const email = calls.find((call) => call.url === "https://api.resend.com/emails");
  assert.ok(email);
  const payload = JSON.parse(email.init.body);
  assert.deepEqual(payload.to, ["buyer@example.com"]);
  assert.equal(payload.attachments, undefined);
  const match = payload.text.match(/https:\/\/agentic\.lvlltd\.com\/api\/download\?token=(\S+)/);
  assert.ok(match);
  const verified = verifyDownloadToken(decodeURIComponent(match[1]), SIGNING);
  assert.equal(verified.ok, true);
  assert.equal(verified.sessionId, "cs_live_abc123");
  assert.equal(verified.sku, "lvl-x402-merchant-os");
  const mark = calls.find((call) => call.url === "https://api.stripe.com/v1/payment_intents/pi_live_1");
  assert.ok(mark);
  assert.match(mark.init.body, /metadata%5Blvl_delivery_emailed_at%5D=/);
});

test("webhook: async_payment_succeeded and payment_intent.succeeded also deliver", async () => {
  const handler = require("../api/index");
  for (const [type, object] of [
    ["checkout.session.async_payment_succeeded", { id: "cs_live_abc123" }],
    ["payment_intent.succeeded", { id: "pi_live_1" }],
  ]) {
    setEnv({ ...LIVE_ENV });
    mockNetwork(paidSession());
    const res = mockRes();
    await handler(signedEvent(type, object), res);
    assert.equal(res.statusCode, 200, type);
    const body = JSON.parse(res.body);
    assert.equal(body.deliverable, true, type);
    assert.equal(body.emailed, false);
    assert.equal(body.reason, "email_not_configured");
  }
});

test("webhook: an already-emailed PaymentIntent is not emailed twice on Stripe retries", async () => {
  setEnv({ ...LIVE_ENV, RESEND_API_KEY: "re_dummy", DELIVERY_FROM_EMAIL: "orders@example.com" });
  const calls = mockNetwork(paidSession({ pi: { metadata: { lvl_delivery_emailed_at: "2026-09-25T15:00:00Z" } } }));
  const handler = require("../api/index");
  const res = mockRes();
  await handler(signedEvent("checkout.session.completed", { id: "cs_live_abc123" }), res);
  const body = JSON.parse(res.body);
  assert.equal(body.deliverable, true);
  assert.equal(body.reason, "already_emailed");
  assert.equal(calls.some((call) => call.url.includes("resend")), false);
});

// ---------- /buy/success ----------

test("/buy/success shows the signed link only when Stripe reports paid", async () => {
  const handler = require("../api/index");
  setEnv({ ...LIVE_ENV });
  mockNetwork(paidSession());
  const paid = mockRes();
  await handler(getReq("/buy/success?session_id=cs_live_abc123"), paid);
  assert.equal(paid.statusCode, 200);
  assert.match(paid.headers["content-type"], /text\/html/);
  assert.match(paid.body, /\/api\/download\?token=/);
  assert.match(paid.body, new RegExp(DELIVERY_PACKS["lvl-x402-merchant-os"].content_sha256));

  const rejected = [
    [paidSession({ session: { payment_status: "unpaid" } }), 202],
    [paidSession({ charge: { refunded: true, amount_refunded: 99 } }), 403],
    [paidSession({ charge: { disputed: true } }), 403],
  ];
  for (const [session, status] of rejected) {
    setEnv({ ...LIVE_ENV });
    mockNetwork(session);
    const res = mockRes();
    await handler(getReq("/buy/success?session_id=cs_live_abc123"), res);
    assert.equal(res.statusCode, status);
    assert.doesNotMatch(res.body, /api\/download\?token=/);
  }

  setEnv({ ...LIVE_ENV });
  const calls = mockNetwork(paidSession());
  const bad = mockRes();
  await handler(getReq("/buy/success?session_id=%3Cscript%3E"), bad);
  assert.equal(bad.statusCode, 400);
  assert.doesNotMatch(bad.body, /<script>/);
  assert.equal(calls.length, 0);
});

// ---------- pack hashing + zip ----------

test("pack map pins both LIVE SKUs to sealed v2.1 packs at commit 40a49f1", () => {
  assert.equal(PACK_SOURCE.commit, "40a49f117e543f11e53d9b106f74221edf9c3445");
  assert.equal(DELIVERY_PACKS["lvl-x402-merchant-os"].pack_id, "x402-merchant-operating-system");
  assert.equal(
    DELIVERY_PACKS["lvl-x402-merchant-os"].content_sha256,
    "3e1c3e1814a28f09190119b1b8ff1d34745cbdbc8cfdcfe2b7868678601f116d"
  );
  assert.equal(DELIVERY_PACKS["lvl-cold-start-catalog-bootstrapper"].pack_id, "cold-start-catalog-bootstrapper");
  assert.equal(
    DELIVERY_PACKS["lvl-cold-start-catalog-bootstrapper"].content_sha256,
    "9f2780f01e977dff975d1f38f118c72f934514f91cd5ee6f7dd608bb9c523607"
  );
});

test("pack hash follows build-sealed-packs: ordered files, excluding pack-files.json and agent-install.json", () => {
  const files = {};
  for (const file of PACK_FILES) files[file] = `content of ${file}`;
  const expected = crypto
    .createHash("sha256")
    .update(
      PACK_FILES.filter((f) => f !== "pack-files.json" && f !== "agent-install.json")
        .map((f) => files[f])
        .join("\n")
    )
    .digest("hex");
  assert.equal(packContentSha256(files), expected);
  assert.equal(packContentSha256({ ...files, "agent-install.json": "changed" }), expected);
  assert.notEqual(packContentSha256({ ...files, "src/index.js": "changed" }), expected);
});

test("zip writer produces a valid archive", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const zip = buildZip({ "a.txt": "hello", "src/b.js": "module.exports = 1;\n" }, "pack");
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  assert.equal(zip.readUInt16LE(eocd + 10), 2);
  const nameLength = zip.readUInt16LE(26);
  const compressedSize = zip.readUInt32LE(18);
  assert.equal(zip.subarray(30, 30 + nameLength).toString(), "pack/a.txt");
  const data = zlib.inflateRawSync(zip.subarray(30 + nameLength, 30 + nameLength + compressedSize));
  assert.equal(data.toString(), "hello");
});
