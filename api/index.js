"use strict";

const market = require("./market");
const handleStripeTestCheckout = require("./stripe-test-checkout");

function requestPath(req) {
  const host = String(req.headers.host || "agentic.lvlltd.com").split(",")[0].trim();
  const url = new URL(req.url || "/", `https://${host}`);
  return url.pathname || "/";
}

function isCheckoutPath(pathname) {
  return (
    pathname === "/api/checkout" ||
    pathname === "/api/stripe/checkout" ||
    pathname === "/api/checkout/session" ||
    pathname.startsWith("/api/checkout/")
  );
}

module.exports = async function handler(req, res) {
  const pathname = requestPath(req);
  if (isCheckoutPath(pathname)) {
    return handleStripeTestCheckout(req, res);
  }
  return market(req, res);
};
