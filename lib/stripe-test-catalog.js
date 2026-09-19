"use strict";

/**
 * Stripe TEST catalog for the SkillForge successor storefront.
 * TEST mode only. LIVE price_ids are unproven and must not be used
 * without a separate human GO.
 */

const CHECKOUT_METADATA = Object.freeze({
  rail: "a2a-marketplace",
  mode: "test",
  trigger: "skillforge-agentic-buy",
});

const TEST_LISTINGS = Object.freeze([
  Object.freeze({
    a2a_listing_id: "lvl-x402-merchant-os",
    name: "x402 Merchant OS",
    description:
      "Digital skill pack: operating playbook for an x402 catalog, proof, and dispute flow.",
    price_id: "price_1UFmN9ERacEsZ559klrqrc7H",
    amount_usd: "0.99",
    currency: "usd",
    kind: "digital_good",
    mode: "test",
    livemode: false,
  }),
  Object.freeze({
    a2a_listing_id: "lvl-cold-start-catalog-bootstrapper",
    name: "Cold-Start Catalog Bootstrapper",
    description:
      "Digital skill pack: catalog bootstrap playbook for a new marketplace storefront.",
    price_id: "price_1UFmNBERacEsZ559R01gpXx1",
    amount_usd: "0.99",
    currency: "usd",
    kind: "digital_good",
    mode: "test",
    livemode: false,
  }),
]);

// Unproven LIVE ids — reject if a client ever sends them. Do not activate.
const UNPROVEN_LIVE_PRICE_IDS = Object.freeze([
  "price_1UFmzKE9E4WCqx1QjoXF3BMO",
  "price_1UFmzME9E4WCqx1QkzHC4R5h",
]);

const TEST_PRICE_IDS = Object.freeze(
  TEST_LISTINGS.map((listing) => listing.price_id)
);

function listingById(listingId) {
  const id = String(listingId || "").trim();
  return TEST_LISTINGS.find((listing) => listing.a2a_listing_id === id) || null;
}

function listingByPriceId(priceId) {
  const id = String(priceId || "").trim();
  return TEST_LISTINGS.find((listing) => listing.price_id === id) || null;
}

function isUnprovenLivePriceId(priceId) {
  return UNPROVEN_LIVE_PRICE_IDS.includes(String(priceId || "").trim());
}

function isAllowedTestPriceId(priceId) {
  return TEST_PRICE_IDS.includes(String(priceId || "").trim());
}

function checkoutMetadata(listing) {
  return {
    rail: CHECKOUT_METADATA.rail,
    a2a_listing_id: listing.a2a_listing_id,
    price_id: listing.price_id,
    mode: CHECKOUT_METADATA.mode,
    trigger: CHECKOUT_METADATA.trigger,
  };
}

function publicCatalog() {
  return {
    ok: true,
    mode: "test",
    livemode: false,
    rail: CHECKOUT_METADATA.rail,
    trigger: CHECKOUT_METADATA.trigger,
    currency: "usd",
    honesty:
      "Stripe TEST Checkout only. $0.99 is a test amount. Not live revenue. livemode=false.",
    listings: TEST_LISTINGS.map((listing) => ({
      a2a_listing_id: listing.a2a_listing_id,
      name: listing.name,
      description: listing.description,
      price_id: listing.price_id,
      amount_usd: listing.amount_usd,
      amount_label: "$0.99 TEST",
      currency: listing.currency,
      kind: listing.kind,
      mode: "test",
      livemode: false,
      buy: {
        method: "POST",
        path: "/api/checkout",
        body: { a2a_listing_id: listing.a2a_listing_id },
      },
    })),
  };
}

function resolveTestSecretKey(env) {
  const source = env || process.env;
  const candidates = [
    source.STRIPE_SECRET_KEY,
    source.STRIPE_TEST_SECRET_KEY,
    source.STRIPE_RESTRICTED_KEY,
  ];
  const key = candidates.find((value) => typeof value === "string" && value.trim()) || "";
  const trimmed = key.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "missing_stripe_test_key",
      message:
        "Set STRIPE_SECRET_KEY to a Stripe TEST key (sk_test_... or rk_test_...). Live keys are rejected.",
    };
  }
  if (/^[sr]k_live_/.test(trimmed)) {
    return {
      ok: false,
      error: "live_key_rejected",
      message: "Live Stripe keys are rejected in this PR. Use a TEST key only.",
    };
  }
  if (!/^[sr]k_test_/.test(trimmed)) {
    return {
      ok: false,
      error: "key_not_test_mode",
      message: "STRIPE_SECRET_KEY must start with sk_test_ or rk_test_.",
    };
  }
  return { ok: true, key: trimmed };
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
  TEST_LISTINGS,
  UNPROVEN_LIVE_PRICE_IDS,
  TEST_PRICE_IDS,
  listingById,
  listingByPriceId,
  isUnprovenLivePriceId,
  isAllowedTestPriceId,
  checkoutMetadata,
  publicCatalog,
  resolveTestSecretKey,
  encodeStripeForm,
  stripeRequest,
};
