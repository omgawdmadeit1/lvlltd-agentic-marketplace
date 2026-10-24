"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const customerio = require("../lib/customerio");

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const ENV = { CUSTOMERIO_SITE_ID: "site", CUSTOMERIO_TRACK_API_KEY: "key" };

test("track skips silently when env is missing", async () => {
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, status: 200 }; };
  const r = await customerio.track("a@b.co", "purchase_completed", {}, { env: {} });
  assert.equal(r.skipped, true);
  assert.equal(called, false);
});

test("track posts purchase_completed with dedupe id and basic auth", async () => {
  const calls = [];
  global.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
  const r = await customerio.track(
    "a+b@x.co",
    "purchase_completed",
    { product_name: "P", access_url: "https://x/d", price: 19, platform: "lvl" },
    { id: "cs_test_1", env: ENV }
  );
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, "https://track.customer.io/api/v1/customers/a%2Bb%40x.co/events");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Basic " + Buffer.from("site:key").toString("base64"));
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    name: "purchase_completed",
    data: { product_name: "P", access_url: "https://x/d", price: 19, platform: "lvl" },
    id: "cs_test_1",
  });
});

test("identify PUTs customer and never throws on network failure", async () => {
  global.fetch = async () => { throw new Error("down"); };
  const r = await customerio.identify("a@b.co", { source: "lvl" }, { env: ENV });
  assert.equal(r.ok, false);
});
