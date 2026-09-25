"use strict";

/**
 * Automatic digital delivery for agentic.lvlltd.com/buy.
 *   POST /api/stripe/webhook            Stripe-signed events (raw body, STRIPE_WEBHOOK_SECRET)
 *   GET  /api/download?token=...         HMAC link + live Stripe re-check -> verified sealed pack zip
 *   GET  /buy/success?session_id=cs_...  server-verified order page that shows the signed link
 * Delivery happens only after Stripe reports the session paid. Failed, refunded or
 * disputed charges never deliver, including old links (live re-check on every download).
 */

const { listingById, resolveLiveSecretKey, stripeRequest } = require("../lib/stripe-test-catalog");
const {
  verifyStripeSignature,
  retrieveSessionForDelivery,
  assessDeliverability,
  issueDownloadLink,
  resolveSigningSecret,
  verifyDownloadToken,
  isCheckoutSessionId,
  buildZip,
} = require("../lib/delivery");
const { packForSku, loadVerifiedPack } = require("../lib/delivery-packs");
const { sendDeliveryEmail, escapeHtml } = require("../lib/delivery-email");

const DELIVERY_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "payment_intent.succeeded",
]);

// Acknowledged, logged, never delivered. /api/download re-checks Stripe live, so
// links issued before a refund/dispute stop working as well.
const NO_DELIVERY_EVENTS = new Set([
  "charge.refunded",
  "charge.dispute.created",
  "payment_intent.payment_failed",
  "checkout.session.async_payment_failed",
]);

const PENDING_REASONS = new Set([
  "not_paid",
  "session_not_complete",
  "payment_not_succeeded",
  "charge_missing",
  "charge_not_succeeded",
]);

function deliveryOrigin(env) {
  const raw = String((env || process.env).DELIVERY_PUBLIC_ORIGIN || "")
    .trim()
    .replace(/\/+$/, "");
  return /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(raw) ? raw : "https://agentic.lvlltd.com";
}

function log(entry) {
  console.log(JSON.stringify({ at: "agentic_delivery", ...entry }));
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res, status, title, bodyHtml) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-robots-tag", "noindex");
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${escapeHtml(title)} - LVL</title>
<link rel="icon" href="/favicon.svg"/>
<style>
body{margin:0;min-height:100dvh;background:#07060c;color:#f6f3ff;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}
a{color:#c4b5fd}h1{margin:0 0 8px;font-size:1.5rem}.muted{color:#a9a0c4;font-size:13px;line-height:1.5}
.card{max-width:640px;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:16px;background:rgba(255,255,255,.03);margin-top:16px}
.btn{display:inline-block;border-radius:12px;padding:10px 14px;font-weight:700;text-decoration:none;background:linear-gradient(135deg,#f0abfc,#a78bfa 55%,#38bdf8);color:#120b1f}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;word-break:break-all}
</style>
</head>
<body>
<p class="muted"><a href="/buy">&larr; Back to /buy</a></p>
<h1>${escapeHtml(title)}</h1>
<div class="card">${bodyHtml}</div>
</body>
</html>`);
}

function readRawBody(req) {
  // Never touch req.body: the raw bytes are required for Stripe signature checks.
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function findSessionIdForPaymentIntent(paymentIntentId, env) {
  if (!/^pi_[A-Za-z0-9]+$/.test(String(paymentIntentId || ""))) return { ok: true, sessionId: null };
  const secret = resolveLiveSecretKey(env);
  if (!secret.ok) return { ok: false, error: secret.error };
  const { response, json } = await stripeRequest({
    key: secret.key,
    method: "GET",
    path: `/checkout/sessions?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=1`,
  });
  if (!response.ok) return { ok: false, error: "stripe_session_search_failed" };
  const first = json && Array.isArray(json.data) ? json.data[0] : null;
  return { ok: true, sessionId: first && first.id ? first.id : null };
}

/**
 * Re-load the session live from Stripe and, only if deliverable, issue a signed link
 * and email it (once per PaymentIntent). retry=true asks Stripe to redeliver the event.
 */
async function deliverSession(sessionId, env) {
  const loaded = await retrieveSessionForDelivery(sessionId, env);
  if (!loaded.ok) {
    return { deliverable: false, reason: loaded.error, retry: loaded.status >= 500 };
  }
  const decision = assessDeliverability(loaded.session);
  if (!decision.ok) return { deliverable: false, reason: decision.reason };
  const origin = deliveryOrigin(env);
  const link = issueDownloadLink({ origin, sessionId: decision.sessionId, sku: decision.sku, env });
  if (!link.ok) return { deliverable: true, emailed: false, reason: link.error, retry: true };
  if (decision.emailedAt) return { deliverable: true, emailed: false, reason: "already_emailed" };
  const listing = listingById(decision.sku);
  const email = await sendDeliveryEmail(
    {
      to: decision.email,
      productName: listing ? listing.name : decision.sku,
      downloadUrl: link.url,
      successUrl: `${origin}/buy/success?session_id=${encodeURIComponent(decision.sessionId)}`,
      expiresAt: link.expiresAt,
    },
    env
  );
  if (email.ok && decision.paymentIntentId) {
    // Best-effort idempotency marker so Stripe retries don't email twice.
    try {
      await stripeRequest({
        key: loaded.key,
        method: "POST",
        path: `/payment_intents/${encodeURIComponent(decision.paymentIntentId)}`,
        body: { metadata: { lvl_delivery_emailed_at: new Date().toISOString() } },
      });
    } catch (error) {
      log({ warn: "emailed_marker_failed", payment_intent: decision.paymentIntentId });
    }
  }
  if (!email.ok && !email.skipped) {
    return { deliverable: true, emailed: false, reason: email.reason, retry: true };
  }
  return { deliverable: true, emailed: email.ok, reason: email.ok ? "emailed" : email.reason };
}

async function handleStripeWebhook(req, res, env) {
  const secret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    sendJson(res, 503, { ok: false, error: "webhook_secret_missing" });
    return;
  }
  const raw = await readRawBody(req);
  const verified = verifyStripeSignature(raw, req.headers["stripe-signature"], secret);
  if (!verified.ok) {
    sendJson(res, 400, { ok: false, error: verified.error });
    return;
  }
  const event = verified.event || {};
  const type = String(event.type || "");
  const object = (event.data && event.data.object) || {};

  if (NO_DELIVERY_EVENTS.has(type)) {
    log({ event: event.id || null, type, object: object.id || null, deliverable: false });
    sendJson(res, 200, { ok: true, received: true, type, deliverable: false, reason: "no_delivery_event" });
    return;
  }
  if (!DELIVERY_EVENTS.has(type)) {
    sendJson(res, 200, { ok: true, received: true, type, deliverable: false, reason: "ignored_event" });
    return;
  }

  let sessionId = null;
  if (type.startsWith("checkout.session.")) {
    sessionId = object.id || null;
  } else {
    const found = await findSessionIdForPaymentIntent(object.id, env);
    if (!found.ok) {
      sendJson(res, 500, { ok: false, received: true, type, error: found.error });
      return;
    }
    sessionId = found.sessionId;
  }
  if (!sessionId) {
    sendJson(res, 200, { ok: true, received: true, type, deliverable: false, reason: "no_checkout_session" });
    return;
  }

  const result = await deliverSession(sessionId, env);
  log({ event: event.id || null, type, session: sessionId, ...result });
  // The signed link is never echoed in the webhook response.
  sendJson(res, result.retry ? 500 : 200, {
    ok: !result.retry,
    received: true,
    type,
    deliverable: result.deliverable,
    emailed: Boolean(result.emailed),
    reason: result.reason,
  });
}

async function handleDownload(res, url, env) {
  const secret = resolveSigningSecret(env);
  if (!secret) {
    sendJson(res, 503, { ok: false, error: "signing_secret_missing" });
    return;
  }
  const token = verifyDownloadToken(url.searchParams.get("token"), secret);
  if (!token.ok) {
    sendJson(res, token.error === "token_expired" ? 410 : 403, {
      ok: false,
      error: token.error,
      hint: "Reopen /buy/success?session_id=<your Checkout session> for a fresh link.",
    });
    return;
  }
  const loaded = await retrieveSessionForDelivery(token.sessionId, env);
  if (!loaded.ok) {
    sendJson(res, loaded.status, { ok: false, error: loaded.error });
    return;
  }
  const decision = assessDeliverability(loaded.session);
  if (!decision.ok) {
    sendJson(res, 403, { ok: false, error: "not_deliverable", reason: decision.reason });
    return;
  }
  if (decision.sku !== token.sku) {
    sendJson(res, 403, { ok: false, error: "sku_mismatch" });
    return;
  }
  let pack;
  try {
    pack = await loadVerifiedPack(token.sku, env);
  } catch (error) {
    const code = (error && error.code) || "pack_error";
    log({ error: code, sku: token.sku, actual_sha256: (error && error.actual) || null });
    sendJson(res, code === "pack_source_unconfigured" ? 503 : 502, { ok: false, error: code });
    return;
  }
  if (url.searchParams.get("format") === "json") {
    sendJson(res, 200, {
      ok: true,
      sku: pack.sku,
      pack_id: pack.pack_id,
      version: pack.version,
      content_sha256: pack.content_sha256,
      source: pack.source,
      files: pack.files,
    });
    return;
  }
  const zip = buildZip(pack.files, pack.pack_id);
  res.statusCode = 200;
  res.setHeader("content-type", "application/zip");
  res.setHeader("content-disposition", `attachment; filename="${pack.pack_id}-v${pack.version}.zip"`);
  res.setHeader("content-length", String(zip.length));
  res.setHeader("cache-control", "private, no-store");
  res.setHeader("x-lvl-content-sha256", pack.content_sha256);
  res.end(zip);
}

async function handleSuccessPage(res, url, env) {
  const sessionId = String(url.searchParams.get("session_id") || "").trim();
  if (!isCheckoutSessionId(sessionId)) {
    sendHtml(res, 400, "Order not found", `<p>Missing or invalid <code>session_id</code>.</p>`);
    return;
  }
  const loaded = await retrieveSessionForDelivery(sessionId, env);
  if (!loaded.ok) {
    sendHtml(
      res,
      loaded.status,
      "Order lookup unavailable",
      "<p>We could not confirm this order with Stripe right now. Please refresh in a minute.</p>"
    );
    return;
  }
  const decision = assessDeliverability(loaded.session);
  if (!decision.ok) {
    if (PENDING_REASONS.has(decision.reason)) {
      sendHtml(
        res,
        202,
        "Payment not confirmed yet",
        "<p>Stripe has not confirmed this payment yet. Refresh this page shortly; your download link appears here once Stripe reports the payment as paid.</p>"
      );
      return;
    }
    sendHtml(
      res,
      403,
      "Download not available",
      `<p>This order is not eligible for download (${escapeHtml(decision.reason)}).</p>`
    );
    return;
  }
  const link = issueDownloadLink({
    origin: deliveryOrigin(env),
    sessionId: decision.sessionId,
    sku: decision.sku,
    env,
  });
  if (!link.ok) {
    sendHtml(
      res,
      503,
      "Payment confirmed",
      "<p>Stripe confirmed your payment, but the download link could not be issued right now. Please refresh shortly.</p>"
    );
    return;
  }
  const listing = listingById(decision.sku);
  const pack = packForSku(decision.sku);
  sendHtml(
    res,
    200,
    "Payment confirmed - your download is ready",
    `<p><strong>${escapeHtml(listing ? listing.name : decision.sku)}</strong> &middot; sealed pack v${escapeHtml(pack.version)}</p>
<p><a class="btn" rel="nofollow noreferrer" href="${escapeHtml(link.url)}">Download ${escapeHtml(pack.pack_id)}.zip</a></p>
<p class="muted">Link expires ${escapeHtml(new Date(link.expiresAt * 1000).toUTCString())}. Reload this page for a fresh link. We also email this link to the address used at checkout when email delivery is enabled.</p>
<p class="muted">sha256 <code>${escapeHtml(pack.content_sha256)}</code></p>`
  );
}

function deliveryRoute(pathname) {
  if (pathname === "/api/stripe/webhook") return "webhook";
  if (pathname === "/api/download") return "download";
  if (pathname === "/buy/success") return "success";
  return null;
}

module.exports = async function handleDelivery(req, res, route) {
  const env = process.env;
  const url = new URL(req.url || "/", "https://agentic.lvlltd.com");
  const method = (req.method || "GET").toUpperCase();
  try {
    if (route === "webhook") {
      if (method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      return await handleStripeWebhook(req, res, env);
    }
    if (route === "download") {
      if (method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      return await handleDownload(res, url, env);
    }
    if (route === "success") {
      if (method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      return await handleSuccessPage(res, url, env);
    }
    return sendJson(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    log({ route, error: String(error && error.message ? error.message : error) });
    if (route === "success") {
      return sendHtml(res, 500, "Something went wrong", "<p>Please refresh in a minute.</p>");
    }
    return sendJson(res, 500, { ok: false, error: "internal" });
  }
};

module.exports.deliveryRoute = deliveryRoute;
module.exports.deliverSession = deliverSession;
module.exports.DELIVERY_EVENTS = DELIVERY_EVENTS;
module.exports.NO_DELIVERY_EVENTS = NO_DELIVERY_EVENTS;
