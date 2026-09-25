"use strict";

/**
 * Stripe LIVE catalog for the SkillForge successor storefront.
 * Joseph GO 2026-09-19: LIVE flip. Retired TEST price_ids are rejected.
 */

const CHECKOUT_METADATA = Object.freeze({
  rail: "a2a-marketplace",
  mode: "live",
  trigger: "skillforge-agentic-buy",
});

const LIVE_LISTINGS = Object.freeze([
  Object.freeze({
    a2a_listing_id: "lvl-x402-merchant-os",
    name: "x402 Merchant OS",
    description:
      "Digital skill pack: operating playbook for an x402 catalog, proof, and dispute flow.",
    price_id: "price_1UFmzKE9E4WCqx1QjoXF3BMO",
    amount_usd: "0.99",
    currency: "usd",
    kind: "digital_good",
    mode: "live",
    livemode: true,
  }),
  Object.freeze({
    a2a_listing_id: "lvl-cold-start-catalog-bootstrapper",
    name: "Cold-Start Catalog Bootstrapper",
    description:
      "Digital skill pack: catalog bootstrap playbook for a new marketplace storefront.",
    price_id: "price_1UFmzME9E4WCqx1QkzHC4R5h",
    amount_usd: "0.99",
    currency: "usd",
    kind: "digital_good",
    mode: "live",
    livemode: true,
  }),
]);

// Retired TEST ids from the prior ingest. Do not charge these.
const RETIRED_TEST_PRICE_IDS = Object.freeze([
  "price_1UFmN9ERacEsZ559klrqrc7H",
  "price_1UFmNBERacEsZ559R01gpXx1",
]);

const LIVE_PRICE_IDS = Object.freeze(LIVE_LISTINGS.map((listing) => listing.price_id));

function stripeMode(env) {
  const source = env || process.env;
  const raw = String(source.STRIPE_MODE || "live").trim().toLowerCase();
  return raw || "live";
}

function listingById(listingId) {
  const id = String(listingId || "").trim();
  return LIVE_LISTINGS.find((listing) => listing.a2a_listing_id === id) || null;
}

function listingByPriceId(priceId) {
  const id = String(priceId || "").trim();
  return LIVE_LISTINGS.find((listing) => listing.price_id === id) || null;
}

function isRetiredTestPriceId(priceId) {
  return RETIRED_TEST_PRICE_IDS.includes(String(priceId || "").trim());
}

function isAllowedLivePriceId(priceId) {
  return LIVE_PRICE_IDS.includes(String(priceId || "").trim());
}

function checkoutMetadata(listing) {
  return {
    rail: CHECKOUT_METADATA.rail,
    a2a_listing_id: listing.a2a_listing_id,
    sku: listing.a2a_listing_id,
    price_id: listing.price_id,
    mode: CHECKOUT_METADATA.mode,
    trigger: CHECKOUT_METADATA.trigger,
  };
}

function publicCatalog() {
  return {
    ok: true,
    mode: "live",
    livemode: true,
    stripe_mode: stripeMode(),
    rail: CHECKOUT_METADATA.rail,
    trigger: CHECKOUT_METADATA.trigger,
    currency: "usd",
    honesty:
      "Stripe Checkout for two digital skill packs at $0.99. A created session is not a paid charge and is not reported revenue.",
    listings: LIVE_LISTINGS.map((listing) => ({
      a2a_listing_id: listing.a2a_listing_id,
      name: listing.name,
      description: listing.description,
      price_id: listing.price_id,
      amount_usd: listing.amount_usd,
      amount_label: "$0.99",
      currency: listing.currency,
      kind: listing.kind,
      mode: "live",
      livemode: true,
      buy: {
        method: "POST",
        path: "/api/checkout",
        body: { a2a_listing_id: listing.a2a_listing_id },
      },
    })),
  };
}

function resolveLiveSecretKey(env) {
  const source = env || process.env;
  const mode = stripeMode(source);
  if (mode !== "live") {
    return {
      ok: false,
      error: "stripe_mode_not_live",
      message: "This checkout path is LIVE. Set STRIPE_MODE=live (or unset it).",
    };
  }
  const candidates = [
    source.STRIPE_SECRET_KEY,
    source.STRIPE_LIVE_SECRET_KEY,
    source.STRIPE_RESTRICTED_KEY,
  ];
  const key = candidates.find((value) => typeof value === "string" && value.trim()) || "";
  const trimmed = key.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "missing_stripe_live_key",
      message: "Set STRIPE_SECRET_KEY to a Stripe LIVE key (sk_live_... or rk_live_...).",
    };
  }
  if (/^[sr]k_test_/.test(trimmed)) {
    return {
      ok: false,
      error: "test_key_rejected",
      message: "Test Stripe keys are rejected. This checkout path is LIVE (STRIPE_MODE=live).",
    };
  }
  if (!/^[sr]k_live_/.test(trimmed)) {
    return {
      ok: false,
      error: "key_not_live_mode",
      message: "STRIPE_SECRET_KEY must start with sk_live_ or rk_live_.",
    };
  }
  return { ok: true, key: trimmed, mode: "live" };
}

function encodeStripeForm(value, prefix) {
  const parts = [];
  const walk = (node, key) => {
    if (node === undefined || node === null) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${key}[${index}]`));
      return;
    }
    if (typeof node === "object") {
      Object.keys(node).forEach((childKey) => {
        const nextKey = key ? `${key}[${childKey}]` : childKey;
        walk(node[childKey], nextKey);
      });
      return;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(node))}`);
  };
  walk(value, prefix || "");
  return parts.join("&");
}

async function stripeRequest({ key, method, path, body }) {
  const url = `https://api.stripe.com/v1${path}`;
  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  const init = { method, headers };
  if (body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = encodeStripeForm(body);
  }
  const response = await fetch(url, init);
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

module.exports = {
  CHECKOUT_METADATA,
  LIVE_LISTINGS,
  TEST_LISTINGS: LIVE_LISTINGS,
  RETIRED_TEST_PRICE_IDS,
  LIVE_PRICE_IDS,
  stripeMode,
  listingById,
  listingByPriceId,
  isRetiredTestPriceId,
  isAllowedLivePriceId,
  checkoutMetadata,
  publicCatalog,
  resolveLiveSecretKey,
  resolveTestSecretKey: resolveLiveSecretKey,
  encodeStripeForm,
  stripeRequest,
};
