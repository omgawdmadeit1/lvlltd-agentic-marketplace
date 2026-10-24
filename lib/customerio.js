"use strict";

// Minimal Customer.io Track API v1 client. Fire-and-forget: never throws, never
// blocks callers, and silently skips when CUSTOMERIO_SITE_ID / CUSTOMERIO_TRACK_API_KEY are unset.
const BASE = "https://track.customer.io/api/v1/customers/";
const TIMEOUT_MS = 2000;

function creds(env) {
  const e = env || process.env;
  const site = String(e.CUSTOMERIO_SITE_ID || "").trim();
  const key = String(e.CUSTOMERIO_TRACK_API_KEY || "").trim();
  return site && key ? "Basic " + Buffer.from(`${site}:${key}`).toString("base64") : null;
}

function send(method, path, body, env) {
  try {
    const auth = creds(env);
    if (!auth) return Promise.resolve({ ok: false, skipped: true });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    return fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
      .then((r) => ({ ok: r.ok, status: r.status }))
      .catch(() => ({ ok: false }))
      .finally(() => clearTimeout(timer));
  } catch (_) {
    return Promise.resolve({ ok: false });
  }
}

function identify(email, attrs, opts = {}) {
  if (!email) return Promise.resolve({ ok: false, skipped: true });
  return send("PUT", encodeURIComponent(email), { email, ...(attrs || {}) }, opts.env);
}

function track(email, name, data, opts = {}) {
  if (!email || !name) return Promise.resolve({ ok: false, skipped: true });
  const body = { name, data: data || {} };
  if (opts.id) body.id = String(opts.id); // dedupe key
  return send("POST", `${encodeURIComponent(email)}/events`, body, opts.env);
}

module.exports = { identify, track };
