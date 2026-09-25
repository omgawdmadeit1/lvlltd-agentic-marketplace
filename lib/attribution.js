"use strict";

/**
 * Optional marketing attribution for Checkout: ?ref=<code> and utm_* params.
 * ref and utm_* share the allowlist ^[a-z0-9_-]{1,32}$ (utm values are trimmed + lowercased first).
 * Attribution is informational only. It never changes price, product, or delivery,
 * and bad values are dropped silently (never a 400).
 */

const { listingById } = require("./stripe-test-catalog");

const REF_PATTERN = /^[a-z0-9_-]{1,32}$/;
const UTM_KEYS = Object.freeze(["utm_source", "utm_medium", "utm_campaign", "utm_content"]);

/** Valid ref string or null. Strict: no trimming or lowercasing; invalid input is dropped. */
function sanitizeRef(value) {
  return typeof value === "string" && REF_PATTERN.test(value) ? value : null;
}

/**
 * utm value or null: strings only, trimmed and lowercased, then it must match the same
 * ^[a-z0-9_-]{1,32}$ allowlist as ref. No truncation: anything else is dropped silently.
 */
function sanitizeUtmValue(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toLowerCase();
  return REF_PATTERN.test(cleaned) ? cleaned : null;
}

/** Pick only whitelisted attribution fields from an untrusted object. */
function attributionFromInput(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const utm = {};
  for (const key of UTM_KEYS) {
    const value = sanitizeUtmValue(source[key]);
    if (value) utm[key] = value;
  }
  return { ref: sanitizeRef(source.ref), utm };
}

/** Flat metadata entries to merge into Checkout metadata ({} when nothing valid). */
function attributionMetadata(attribution) {
  const out = {};
  if (attribution && attribution.ref) out.ref = attribution.ref;
  if (attribution && attribution.utm) {
    for (const key of UTM_KEYS) if (attribution.utm[key]) out[key] = attribution.utm[key];
  }
  return out;
}

/**
 * Attribution for a fulfillment/webhook record, re-validated from a Stripe session.
 * ref comes from metadata.ref, else client_reference_id. client_reference_id defaults
 * to the listing id when no ref was given, so catalog listing ids are never treated as a ref.
 */
function attributionFromSession(session) {
  const s = session && typeof session === "object" ? session : {};
  const metadata = s.metadata && typeof s.metadata === "object" ? s.metadata : {};
  let ref = sanitizeRef(metadata.ref);
  if (!ref) {
    const fromClientRef = sanitizeRef(s.client_reference_id);
    ref = fromClientRef && !listingById(fromClientRef) ? fromClientRef : null;
  }
  const { utm } = attributionFromInput(metadata);
  return { ref, ...utm };
}

module.exports = {
  REF_PATTERN,
  UTM_KEYS,
  sanitizeRef,
  sanitizeUtmValue,
  attributionFromInput,
  attributionMetadata,
  attributionFromSession,
};
