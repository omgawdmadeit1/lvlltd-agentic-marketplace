"use strict";

const market = require("./market");
const handleStripeTestCheckout = require("./stripe-test-checkout");
const handleDelivery = require("./delivery");

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
  const deliveryRoute = handleDelivery.deliveryRoute(pathname);
  if (deliveryRoute) {
    return handleDelivery(req, res, deliveryRoute);
  }
  if (isCheckoutPath(pathname)) {
    return handleStripeTestCheckout(req, res);
  }
  return market(req, res);
};

// Stripe webhook signatures need the raw body; handlers read the request stream.
module.exports.config = { api: { bodyParser: false } };
