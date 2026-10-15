"use strict";

const fs = require("fs");
const path = require("path");
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

function isAgentCardPath(pathname) {
  return pathname === "/.well-known/agent-card.json" || pathname === "/agent-card.json";
}

module.exports = async function handler(req, res) {
  const pathname = requestPath(req);
  if (isAgentCardPath(pathname)) {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD, OPTIONS");
      res.statusCode = 405;
      res.end("method not allowed");
      return;
    }
    const body = fs.readFileSync(path.join(__dirname, "agent-card.json"));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.statusCode = 200;
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(body);
    return;
  }
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
