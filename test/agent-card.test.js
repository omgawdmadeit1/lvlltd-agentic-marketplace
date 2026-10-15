const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const rd = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("agent card is served from the api and names the real settlement", () => {
  const card = JSON.parse(rd("api/agent-card.json"));
  assert.equal(rd(".well-known/agent-card.json"), rd("api/agent-card.json"));
  assert.equal(card.settlement, "https://lvlltd.com/api/pay");
  assert.equal(card.x402_on_this_host, "stub");
  assert.match(card.note, /0x8E51309870394f79574452A52A3c916622f0c4d1/);
  assert.match(card.note, /Never pay 0xa008/);
  assert.match(card.music_download, /0xa00876513baa433ce2b58a5341fd06d2b6f9a6ed/);
  assert.doesNotMatch(card.music_download, /payTo is 0x8E51/);
  const vercel = JSON.parse(rd("vercel.json"));
  const sources = vercel.rewrites.map((r) => r.source);
  assert.ok(sources.includes("/.well-known/agent-card.json"));
  assert.ok(sources.includes("/agent-card.json"));
  assert.match(rd("api/index.js"), /isAgentCardPath/);
});
