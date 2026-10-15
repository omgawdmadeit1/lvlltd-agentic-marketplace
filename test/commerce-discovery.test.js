const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pub = (p) => path.join(__dirname, "..", "public", p);
const j = (p) => JSON.parse(fs.readFileSync(pub(p), "utf8"));
const LINKS = {
  "lvl-x402-merchant-os": "https://buy.stripe.com/cNi9ATgaZ5UW4CD6mtgUM0b",
  "lvl-cold-start-catalog-bootstrapper": "https://buy.stripe.com/eVq7sL2k9fvw8ST8uBgUM0c",
};

test("ACP discovery: required fields, merchant API on lvlltd.com, honest notes", () => {
  const a = j(".well-known/acp.json");
  assert.equal(a.protocol.name, "acp");
  assert.ok(a.protocol.version);
  assert.equal(a.api_base_url, "https://lvlltd.com/api/acp");
  assert.ok(a.transports.length && a.capabilities.services.includes("checkout"));
  assert.match(a.notes, /stub and does not settle/);
});

test("UCP profile: required fields point at the real lvlltd.com endpoints", () => {
  const u = j(".well-known/ucp");
  for (const k of ["protocol_version", "services", "capabilities", "endpoints"]) assert.ok(k in u, k);
  assert.equal(u.endpoints.checkout_sessions, "https://lvlltd.com/api/ucp/checkout-sessions");
});

test("MPP: root openapi payable ops are Stripe $0.99, only the two packs, same links as the page", () => {
  const o = j("openapi.json");
  const pay = Object.values(o.paths).flatMap((ops) => Object.values(ops)).filter((op) => op["x-payment-info"]);
  assert.equal(pay.length, 2);
  for (const op of pay) {
    const p = op["x-payment-info"];
    assert.equal(p.intent, "charge");
    assert.equal(p.method, "stripe");
    assert.equal(p.amount, "99");
    assert.equal(op.servers[0].url, "https://lvlltd.com");
    for (const [id, link] of Object.entries(LINKS)) assert.ok(p["x-offers-by-item"].some((x) => x.description.includes(link)), id);
  }
  const html = fs.readFileSync(pub("buy.html"), "utf8");
  for (const link of Object.values(LINKS)) assert.ok(html.includes(link), link);
});
