"use strict";

const {
  listingById,
  listingByPriceId,
  isUnprovenLivePriceId,
  checkoutMetadata,
  publicCatalog,
  resolveTestSecretKey,
  stripeRequest,
} = require("../lib/stripe-test-catalog");

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

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function requestUrl(req) {
  const host = String(req.headers.host || "agentic.lvlltd.com").split(",")[0].trim();
  return new URL(req.url || "/", `https://${host}`);
}

function publicOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "agentic.lvlltd.com")
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

function resolveListing(input) {
  const listingId = String(input.a2a_listing_id || input.listing_id || input.skill || "").trim();
  const priceId = String(input.price_id || "").trim();
  if (priceId && isUnprovenLivePriceId(priceId)) {
    return {
      error: "live_price_id_rejected",
      message: "Unproven LIVE price_ids are blocked. TEST catalog only.",
    };
  }
  if (listingId) {
    const listing = listingById(listingId);
    if (!listing) {
      return {
        error: "listing_not_in_test_catalog",
        message: "Unknown a2a_listing_id. TEST catalog is two digital SKUs only.",
      };
    }
    if (priceId && priceId !== listing.price_id) {
      return {
        error: "price_id_mismatch",
        message: "price_id does not match the allowlisted TEST price for this listing.",
      };
    }
    return { listing };
  }
  if (priceId) {
    const listing = listingByPriceId(priceId);
    if (!listing) {
      return {
        error: "price_id_not_in_test_catalog",
        message: "price_id is not one of the proven TEST ids.",
      };
    }
    return { listing };
  }
  return {
    error: "listing_required",
    message: "POST { a2a_listing_id } for lvl-x402-merchant-os or lvl-cold-start-catalog-bootstrapper.",
  };
}

function publicSession(session, listing) {
  return {
    ok: true,
    mode: "test",
    livemode: false,
    honesty: "Stripe TEST session. Not live revenue.",
    listing: listing
      ? {
          a2a_listing_id: listing.a2a_listing_id,
          name: listing.name,
          price_id: listing.price_id,
          amount_label: "$0.99 TEST",
          mode: "test",
          livemode: false,
        }
      : null,
    checkout: {
      id: session.id || null,
      url: session.url || null,
      status: session.status || null,
      payment_status: session.payment_status || null,
      amount_total: session.amount_total || null,
      currency: session.currency || null,
      livemode: false,
      mode: "test",
      metadata: session.metadata || checkoutMetadata(listing),
    },
  };
}

async function createCheckoutSession(req, listing) {
  const secret = resolveTestSecretKey(process.env);
  if (!secret.ok) {
    return { status: 503, body: { ok: false, mode: "test", livemode: false, ...secret } };
  }
  const origin = publicOrigin(req);
  const metadata = checkoutMetadata(listing);
  const { response, json } = await stripeRequest({
    key: secret.key,
    method: "POST",
    path: "/checkout/sessions",
    body: {
      mode: "payment",
      client_reference_id: listing.a2a_listing_id,
      success_url: `${origin}/buy?checkout=success&listing=${encodeURIComponent(listing.a2a_listing_id)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/buy?checkout=cancel&listing=${encodeURIComponent(listing.a2a_listing_id)}`,
      line_items: [{ price: listing.price_id, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
    },
  });
  if (!response.ok || !json || !json.id) {
    return {
      status: response.status >= 400 ? response.status : 502,
      body: {
        ok: false,
        mode: "test",
        livemode: false,
        error: "stripe_checkout_failed",
        message: "Stripe TEST Checkout session was not created. Check the TEST key and price_id.",
        stripe_type: json && json.error && json.error.type ? json.error.type : null,
        stripe_code: json && json.error && json.error.code ? json.error.code : null,
      },
    };
  }
  if (json.livemode === true) {
    return {
      status: 409,
      body: {
        ok: false,
        mode: "test",
        livemode: false,
        error: "livemode_session_rejected",
        message: "Stripe returned a live session. TEST mode only — session not forwarded.",
      },
    };
  }
  return { status: 200, body: publicSession(json, listing) };
}

async function retrieveCheckoutSession(sessionId) {
  const secret = resolveTestSecretKey(process.env);
  if (!secret.ok) {
    return { status: 503, body: { ok: false, mode: "test", livemode: false, ...secret } };
  }
  const id = String(sessionId || "").trim();
  if (!/^cs_(test_)?[A-Za-z0-9]+$/.test(id)) {
    return {
      status: 400,
      body: { ok: false, mode: "test", livemode: false, error: "invalid_session_id" },
    };
  }
  const { response, json } = await stripeRequest({
    key: secret.key,
    method: "GET",
    path: `/checkout/sessions/${encodeURIComponent(id)}`,
  });
  if (!response.ok) {
    return {
      status: response.status >= 400 ? response.status : 502,
      body: {
        ok: false,
        mode: "test",
        livemode: false,
        error: "stripe_session_lookup_failed",
        message: "Could not load this Stripe TEST session.",
      },
    };
  }
  if (json.livemode === true) {
    return {
      status: 409,
      body: {
        ok: false,
        mode: "test",
        livemode: false,
        error: "livemode_session_rejected",
        message: "Live sessions are not shown here.",
      },
    };
  }
  const listing =
    listingById(json.metadata && json.metadata.a2a_listing_id) ||
    listingByPriceId(json.metadata && json.metadata.price_id);
  return { status: 200, body: publicSession(json, listing) };
}

module.exports = async function handleStripeTestCheckout(req, res) {
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
      const body = await readBody(req);
      const resolved = resolveListing(body);
      if (resolved.error) {
        send(res, 400, { ok: false, mode: "test", livemode: false, ...resolved });
        return;
      }
      const result = await createCheckoutSession(req, resolved.listing);
      send(res, result.status, result.body);
      return;
    }

    send(res, 404, {
      ok: false,
      mode: "test",
      livemode: false,
      error: "not_found",
      hint: "GET /api/checkout or POST /api/checkout { a2a_listing_id }",
    });
  } catch (error) {
    send(res, 500, {
      ok: false,
      mode: "test",
      livemode: false,
      error: "internal",
      message: String(error && error.message ? error.message : error),
    });
  }
};

module.exports.resolveListing = resolveListing;
module.exports.publicSession = publicSession;
