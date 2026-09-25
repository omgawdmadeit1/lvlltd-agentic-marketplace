"use strict";

/**
 * Automatic digital delivery helpers (no external deps, Node crypto/zlib only).
 * - Stripe webhook signature verification (raw body, 5 min tolerance, timing-safe)
 * - HMAC download tokens binding checkout session id + sku + expiry
 * - Live Stripe deliverability check: paid, not refunded, not disputed
 * - Tiny zip writer for serverless delivery
 */

const crypto = require("crypto");
const zlib = require("zlib");
const {
  listingById,
  listingByPriceId,
  resolveLiveSecretKey,
  stripeRequest,
} = require("./stripe-test-catalog");
const { packForSku } = require("./delivery-packs");

const WEBHOOK_TOLERANCE_SECONDS = 300;
const DEFAULT_LINK_TTL_HOURS = 72;
const MAX_LINK_TTL_HOURS = 168;
const MIN_SIGNING_SECRET_LENGTH = 32;

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Verify a Stripe-Signature header against the raw request body.
 * Returns { ok: true, event } or { ok: false, error }.
 */
function verifyStripeSignature(rawBody, header, secret, options) {
  const opts = options || {};
  const tolerance = opts.toleranceSeconds || WEBHOOK_TOLERANCE_SECONDS;
  const now = Number.isFinite(opts.nowSeconds) ? opts.nowSeconds : Math.floor(Date.now() / 1000);
  if (!secret) return { ok: false, error: "webhook_secret_missing" };
  if (!header || typeof header !== "string") return { ok: false, error: "signature_missing" };
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (!Number.isFinite(timestamp) || !signatures.length) {
    return { ok: false, error: "signature_malformed" };
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.`, "utf8")
    .update(body)
    .digest("hex");
  const matched = signatures.some((sig) => timingSafeEqualString(sig, expected));
  if (!matched) return { ok: false, error: "signature_mismatch" };
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, error: "signature_stale" };
  try {
    return { ok: true, event: JSON.parse(body.toString("utf8")) };
  } catch {
    return { ok: false, error: "body_not_json" };
  }
}

/** Test helper / docs: build a valid Stripe-Signature header. */
function signStripePayload(rawBody, secret, timestamp) {
  const t = Number.isFinite(timestamp) ? timestamp : Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  return `t=${t},v1=${sig}`;
}

function resolveSigningSecret(env) {
  const source = env || process.env;
  const secret = String(source.DELIVERY_SIGNING_SECRET || "").trim();
  if (secret.length < MIN_SIGNING_SECRET_LENGTH) return null;
  return secret;
}

function linkTtlSeconds(env) {
  const source = env || process.env;
  const hours = Number(source.DELIVERY_LINK_TTL_HOURS);
  const safe =
    Number.isFinite(hours) && hours > 0 ? Math.min(hours, MAX_LINK_TTL_HOURS) : DEFAULT_LINK_TTL_HOURS;
  return Math.round(safe * 3600);
}

function signDownloadToken({ sessionId, sku, expiresAt }, secret) {
  if (!secret) throw new Error("DELIVERY_SIGNING_SECRET missing");
  const payload = Buffer.from(JSON.stringify({ v: 1, sid: sessionId, sku, exp: expiresAt })).toString(
    "base64url"
  );
  const mac = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function verifyDownloadToken(token, secret, nowSeconds) {
  if (!secret) return { ok: false, error: "signing_secret_missing" };
  const value = String(token || "");
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".")) return { ok: false, error: "token_malformed" };
  const payload = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (!timingSafeEqualString(mac, expected)) return { ok: false, error: "token_invalid" };
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "token_malformed" };
  }
  if (!data || data.v !== 1 || typeof data.sid !== "string" || typeof data.sku !== "string") {
    return { ok: false, error: "token_malformed" };
  }
  const now = Number.isFinite(nowSeconds) ? nowSeconds : Math.floor(Date.now() / 1000);
  if (!Number.isFinite(data.exp) || data.exp <= now) return { ok: false, error: "token_expired" };
  if (!packForSku(data.sku)) return { ok: false, error: "token_unknown_sku" };
  return { ok: true, sessionId: data.sid, sku: data.sku, expiresAt: data.exp };
}

function isCheckoutSessionId(id) {
  return /^cs_(test_|live_)?[A-Za-z0-9]+$/.test(String(id || ""));
}

/** Load a Checkout Session live from Stripe with its PaymentIntent, charge and line items. */
async function retrieveSessionForDelivery(sessionId, env) {
  const secret = resolveLiveSecretKey(env || process.env);
  if (!secret.ok) return { ok: false, status: 503, error: secret.error };
  if (!isCheckoutSessionId(sessionId)) return { ok: false, status: 400, error: "invalid_session_id" };
  const expand = ["payment_intent", "payment_intent.latest_charge", "line_items"]
    .map((item) => `expand[]=${encodeURIComponent(item)}`)
    .join("&");
  const { response, json } = await stripeRequest({
    key: secret.key,
    method: "GET",
    path: `/checkout/sessions/${encodeURIComponent(sessionId)}?${expand}`,
  });
  if (!response.ok || !json || !json.id) {
    return {
      ok: false,
      status: response.status === 404 ? 404 : 502,
      error: "stripe_session_lookup_failed",
    };
  }
  return { ok: true, session: json, key: secret.key };
}

function chargeFromPaymentIntent(paymentIntent) {
  if (!paymentIntent || typeof paymentIntent !== "object") return null;
  if (paymentIntent.latest_charge && typeof paymentIntent.latest_charge === "object") {
    return paymentIntent.latest_charge;
  }
  const legacy = paymentIntent.charges && paymentIntent.charges.data;
  return Array.isArray(legacy) && legacy.length ? legacy[0] : null;
}

function skuForSession(session) {
  const metadata = (session && session.metadata) || {};
  const byMeta = listingById(metadata.sku) || listingById(metadata.a2a_listing_id);
  const lineItems =
    session && session.line_items && Array.isArray(session.line_items.data)
      ? session.line_items.data
      : [];
  const linePrice = lineItems.length && lineItems[0].price ? lineItems[0].price.id : null;
  const byLine = listingByPriceId(linePrice);
  const byMetaPrice = listingByPriceId(metadata.price_id);
  // If the actually charged line item is known it must agree with metadata.
  if (byLine && byMeta && byLine.a2a_listing_id !== byMeta.a2a_listing_id) return null;
  const listing = byLine || byMeta || byMetaPrice;
  return listing ? listing.a2a_listing_id : null;
}

/**
 * Pure decision: may this Stripe Checkout Session receive the pack?
 * Delivery only when Stripe says paid AND the charge is not refunded/disputed.
 */
function assessDeliverability(session) {
  if (!session || typeof session !== "object") return { ok: false, reason: "session_missing" };
  if (session.livemode !== true) return { ok: false, reason: "not_livemode" };
  if (session.mode && session.mode !== "payment") return { ok: false, reason: "not_payment_mode" };
  if (session.status !== "complete") return { ok: false, reason: "session_not_complete" };
  if (session.payment_status !== "paid") return { ok: false, reason: "not_paid" };
  const sku = skuForSession(session);
  if (!sku || !packForSku(sku)) return { ok: false, reason: "sku_not_deliverable" };
  const paymentIntent = session.payment_intent;
  if (!paymentIntent || typeof paymentIntent !== "object") {
    return { ok: false, reason: "payment_intent_missing" };
  }
  if (paymentIntent.status !== "succeeded") return { ok: false, reason: "payment_not_succeeded" };
  const charge = chargeFromPaymentIntent(paymentIntent);
  if (!charge) return { ok: false, reason: "charge_missing" };
  if (charge.paid !== true || charge.status !== "succeeded") {
    return { ok: false, reason: "charge_not_succeeded" };
  }
  if (charge.refunded === true || Number(charge.amount_refunded || 0) > 0) {
    return { ok: false, reason: "refunded" };
  }
  if (charge.disputed === true) return { ok: false, reason: "disputed" };
  return {
    ok: true,
    sku,
    sessionId: session.id,
    paymentIntentId: paymentIntent.id || null,
    email:
      (session.customer_details && session.customer_details.email) || session.customer_email || null,
    emailedAt: (paymentIntent.metadata && paymentIntent.metadata.lvl_delivery_emailed_at) || null,
  };
}

function buildDownloadUrl(origin, token) {
  return `${origin}/api/download?token=${encodeURIComponent(token)}`;
}

function issueDownloadLink({ origin, sessionId, sku, env, nowSeconds }) {
  const secret = resolveSigningSecret(env);
  if (!secret) return { ok: false, error: "signing_secret_missing" };
  const now = Number.isFinite(nowSeconds) ? nowSeconds : Math.floor(Date.now() / 1000);
  const expiresAt = now + linkTtlSeconds(env);
  const token = signDownloadToken({ sessionId, sku, expiresAt }, secret);
  return { ok: true, url: buildDownloadUrl(origin, token), expiresAt };
}

// ---- minimal zip writer (deflate, no dependency) ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** files: { "dir/name": string } -> Buffer (zip). Entry names are prefixed with `root/`. */
function buildZip(files, root) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const names = Object.keys(files).sort();
  for (const name of names) {
    const data = Buffer.from(String(files[name]), "utf8");
    const compressed = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(root ? `${root}/${name}` : name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, compressed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

module.exports = {
  WEBHOOK_TOLERANCE_SECONDS,
  DEFAULT_LINK_TTL_HOURS,
  MAX_LINK_TTL_HOURS,
  verifyStripeSignature,
  signStripePayload,
  resolveSigningSecret,
  linkTtlSeconds,
  signDownloadToken,
  verifyDownloadToken,
  isCheckoutSessionId,
  retrieveSessionForDelivery,
  assessDeliverability,
  skuForSession,
  issueDownloadLink,
  buildDownloadUrl,
  buildZip,
  crc32,
};
