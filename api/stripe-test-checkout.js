"use strict";

const {
  listingById,
  listingByPriceId,
  isRetiredTestPriceId,
  checkoutMetadata,
  publicCatalog,
  resolveLiveSecretKey,
  stripeRequest,
} = require("../lib/stripe-test-catalog");
const { deliveryOrigin, checkoutSuccessUrl, successPageUrl } = require("../lib/delivery");
const { attributionFromInput, attributionMetadata } = require("../lib/attribution");

function send(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "content-type, authorization, x-agent-id, x-payment"
  );
  res.setHeader("cache-control", "no-store");
  res.end(payload);
}

const DEFAULT_ALLOWED_ORIGINS = Object.freeze(["https://agentic.lvlltd.com"]);
const LISTING_ID_PATTERN = /^[a-z0-9-]{3,64}$/;
const PRICE_ID_PATTERN = /^price_[A-Za-z0-9]{8,64}$/;
const MAX_BODY_BYTES = 4096;

/** Reads a JSON object body. Empty, oversized, non-JSON or non-object bodies are rejected. */
function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return resolve({ ok: false, error: "body_too_large" });
      const text = Buffer.concat(chunks).toString().trim();
      if (!text) return resolve({ ok: false, error: "body_required" });
      try {
        const value = JSON.parse(text);
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return resolve({ ok: false, error: "body_not_object" });
        }
        return resolve({ ok: true, value });
      } catch {
        return resolve({ ok: false, error: "invalid_json" });
      }
    });
    req.on("error", () => resolve({ ok: false, error: "body_unreadable" }));
  });
}

function toOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function allowedOrigins(env) {
  const source = env || process.env;
  const configured = String(source.CHECKOUT_ALLOWED_ORIGINS || "")
    .split(",")
    .map(toOrigin)
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS.slice();
}

// Local dev (scripts/local-storefront.js) only: never on Vercel or NODE_ENV=production.
function isLocalDevOrigin(origin, env) {
  const source = env || process.env;
  if (source.VERCEL || source.NODE_ENV === "production") return false;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/**
 * Anti-spam gate for POST /api/checkout. Origin first, then Referer's origin.
 * Header-less callers are rejected unless CHECKOUT_ALLOW_NO_ORIGIN=1.
 * Note: headers are forgeable by non-browser clients; this blocks cross-site and naive bots.
 */
function checkRequestOrigin(req, env) {
  const source = env || process.env;
  const headers = req.headers || {};
  const rawOrigin = headers.origin;
  const rawReferer = headers.referer || headers.referrer;
  let origin = null;
  let via = null;
  if (rawOrigin !== undefined && String(rawOrigin).trim() !== "") {
    origin = toOrigin(rawOrigin);
    via = "origin";
  } else if (rawReferer !== undefined && String(rawReferer).trim() !== "") {
    origin = toOrigin(rawReferer);
    via = "referer";
  }
  if (!via) {
    const optIn = ["1", "true"].includes(String(source.CHECKOUT_ALLOW_NO_ORIGIN || "").trim().toLowerCase());
    return optIn
      ? { ok: true, via: "no_origin_opt_in" }
      : {
          ok: false,
          error: "origin_required",
          message: "POST /api/checkout must come from https://agentic.lvlltd.com/buy.",
        };
  }
  if (origin && (allowedOrigins(source).includes(origin) || isLocalDevOrigin(origin, source))) {
    return { ok: true, via };
  }
  return {
    ok: false,
    error: "origin_not_allowed",
    message: "POST /api/checkout must come from https://agentic.lvlltd.com/buy.",
  };
}

function requestUrl(req) {
  const host = String(req.headers.host || "agentic.lvlltd.com").split(",")[0].trim();
  return new URL(req.url || "/", `https://${host}`);
}

function fail(extra) {
  return { ok: false, mode: "live", livemode: true, ...extra };
}

function resolveListing(input) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const rawPrice = body.price_id;
  if (rawPrice !== undefined && rawPrice !== null && rawPrice !== "") {
    if (typeof rawPrice !== "string" || !PRICE_ID_PATTERN.test(rawPrice)) {
      return { error: "invalid_price_id", message: "price_id must be a Stripe price id string." };
    }
    if (isRetiredTestPriceId(rawPrice)) {
      return {
        error: "test_price_id_rejected",
        message: "Retired TEST price_ids are blocked. LIVE catalog only.",
      };
    }
  }
  const priceId = typeof rawPrice === "string" ? rawPrice : "";
  const rawId = [body.a2a_listing_id, body.listing_id, body.skill].find(
    (value) => value !== undefined && value !== null && value !== ""
  );
  if (rawId === undefined) {
    return {
      error: "listing_required",
      message: "POST { a2a_listing_id } for lvl-x402-merchant-os or lvl-cold-start-catalog-bootstrapper.",
    };
  }
  if (typeof rawId !== "string" || !LISTING_ID_PATTERN.test(rawId)) {
    return {
      error: "invalid_listing_id",
      message: "a2a_listing_id must match /^[a-z0-9-]{3,64}$/.",
    };
  }
  const listing = listingById(rawId);
  if (!listing) {
    return {
      error: "listing_not_in_live_catalog",
      message: "Unknown a2a_listing_id. LIVE catalog is two digital SKUs only.",
    };
  }
  if (priceId && priceId !== listing.price_id) {
    return {
      error: "price_id_mismatch",
      message: "price_id does not match the allowlisted LIVE price for this listing.",
    };
  }
  return { listing };
}

function publicSession(session, listing) {
  return {
    ok: true,
    mode: "live",
    livemode: true,
    honesty:
      "Stripe Checkout session created. This is not a revenue claim until Stripe reports a paid live charge.",
    listing: listing
      ? {
          a2a_listing_id: listing.a2a_listing_id,
          name: listing.name,
          price_id: listing.price_id,
          amount_label: "$0.99",
          mode: "live",
          livemode: true,
        }
      : null,
    checkout: {
      id: session.id || null,
      url: session.url || null,
      status: session.status || null,
      payment_status: session.payment_status || null,
      amount_total: session.amount_total || null,
      currency: session.currency || null,
      livemode: true,
      mode: "live",
      metadata: session.metadata || (listing ? checkoutMetadata(listing) : null),
    },
    // Order/download page on this storefront; it only shows the signed link once Stripe reports paid.
    pack_download_url: successPageUrl(session.id),
  };
}

async function createCheckoutSession(listing, attribution) {
  const secret = resolveLiveSecretKey(process.env);
  if (!secret.ok) {
    return { status: 503, body: fail(secret) };
  }
  // Fixed public origin (DELIVERY_PUBLIC_ORIGIN, default https://agentic.lvlltd.com), never the Host header.
  const origin = deliveryOrigin(process.env);
  // Optional ?ref= / utm_* attribution: informational only, merged after the catalog keys.
  const extra = attributionMetadata(attribution);
  const metadata = { ...checkoutMetadata(listing), ...extra };
  const { response, json } = await stripeRequest({
    key: secret.key,
    method: "POST",
    path: "/checkout/sessions",
    body: {
      mode: "payment",
      client_reference_id: extra.ref || listing.a2a_listing_id,
      // Server-verified order page: shows the signed download link only once Stripe reports paid.
      success_url: checkoutSuccessUrl(process.env),
      cancel_url: `${origin}/buy?checkout=cancel&listing=${encodeURIComponent(listing.a2a_listing_id)}`,
      line_items: [{ price: listing.price_id, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      custom_text: {
        submit: {
          message: "After payment you get an instant download link on the next page and by email.",
        },
      },
    },
  });
  if (!response.ok || !json || !json.id) {
    return {
      status: response.status >= 400 ? response.status : 502,
      body: fail({
        error: "stripe_checkout_failed",
        message: "Stripe Checkout session was not created. Check the LIVE key and price_id.",
        stripe_type: json && json.error && json.error.type ? json.error.type : null,
        stripe_code: json && json.error && json.error.code ? json.error.code : null,
      }),
    };
  }
  if (json.livemode !== true) {
    return {
      status: 409,
      body: fail({
        error: "test_session_rejected",
        message: "Stripe returned a test session. LIVE mode only — session not forwarded.",
      }),
    };
  }
  return { status: 200, body: publicSession(json, listing) };
}

async function retrieveCheckoutSession(sessionId) {
  const secret = resolveLiveSecretKey(process.env);
  if (!secret.ok) {
    return { status: 503, body: fail(secret) };
  }
  const id = String(sessionId || "").trim();
  if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(id)) {
    return { status: 400, body: fail({ error: "invalid_session_id" }) };
  }
  const { response, json } = await stripeRequest({
    key: secret.key,
    method: "GET",
    path: `/checkout/sessions/${encodeURIComponent(id)}`,
  });
  if (!response.ok) {
    return {
      status: response.status >= 400 ? response.status : 502,
      body: fail({
        error: "stripe_session_lookup_failed",
        message: "Could not load this Stripe Checkout session.",
      }),
    };
  }
  if (json.livemode !== true) {
    return {
      status: 409,
      body: fail({
        error: "test_session_rejected",
        message: "Test sessions are not shown on this LIVE storefront.",
      }),
    };
  }
  const listing =
    listingById(json.metadata && json.metadata.a2a_listing_id) ||
    listingByPriceId(json.metadata && json.metadata.price_id);
  return { status: 200, body: publicSession(json, listing) };
}

module.exports = async function handleStripeLiveCheckout(req, res) {
  try {
    if ((req.method || "GET").toUpperCase() === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      res.setHeader(
        "access-control-allow-headers",
        "content-type, authorization, x-agent-id, x-payment"
      );
      res.end();
      return;
    }
    const url = requestUrl(req);
    const method = (req.method || "GET").toUpperCase();
    const path = url.pathname || "/";

    if (method === "GET" && (path === "/api/checkout" || path === "/api/stripe/checkout")) {
      send(res, 200, publicCatalog());
      return;
    }

    if (method === "GET" && path === "/api/checkout/session") {
      const result = await retrieveCheckoutSession(url.searchParams.get("session_id"));
      send(res, result.status, result.body);
      return;
    }

    if (method === "POST" && (path === "/api/checkout" || path === "/api/stripe/checkout")) {
      const gate = checkRequestOrigin(req, process.env);
      if (!gate.ok) {
        send(res, 403, fail({ error: gate.error, message: gate.message }));
        return;
      }
      const body = await readJsonBody(req);
      if (!body.ok) {
        send(res, 400, fail({ error: body.error, message: "POST a JSON object { a2a_listing_id }." }));
        return;
      }
      const resolved = resolveListing(body.value);
      if (resolved.error) {
        send(res, 400, fail(resolved));
        return;
      }
      const result = await createCheckoutSession(resolved.listing, attributionFromInput(body.value));
      send(res, result.status, result.body);
      return;
    }

    send(res, 404, fail({
      error: "not_found",
      hint: "GET /api/checkout or POST /api/checkout { a2a_listing_id }",
    }));
  } catch (error) {
    send(res, 500, fail({
      error: "internal",
      message: String(error && error.message ? error.message : error),
    }));
  }
};

module.exports.resolveListing = resolveListing;
module.exports.publicSession = publicSession;
module.exports.checkRequestOrigin = checkRequestOrigin;
module.exports.allowedOrigins = allowedOrigins;
module.exports.LISTING_ID_PATTERN = LISTING_ID_PATTERN;
