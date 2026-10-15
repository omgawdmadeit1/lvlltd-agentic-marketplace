const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..");
const pub = (p) => path.join(root, "public", p);
const rd = (p) => fs.readFileSync(pub(p), "utf8");

test("robots.txt has Content-Signal, sitemap and agentmap", () => {
  const r = rd("robots.txt");
  assert.match(r, /Content-Signal: search=yes, ai-input=yes, ai-train=no/);
  assert.match(r, /User-agent: GPTBot/);
  assert.match(r, /Sitemap: https:\/\/agentic\.lvlltd\.com\/sitemap\.xml/);
  assert.match(rd("sitemap.xml"), /<loc>https:\/\/agentic\.lvlltd\.com\/buy<\/loc>/);
});

test("agent-skills index digests match the served SKILL.md bytes", () => {
  const idx = JSON.parse(rd(".well-known/agent-skills/index.json"));
  assert.match(idx.$schema, /0\.2\.0/);
  for (const s of idx.skills) {
    const body = fs.readFileSync(pub(s.url.slice(1)));
    assert.equal(s.digest, "sha256:" + crypto.createHash("sha256").update(body).digest("hex"));
  }
});

test("ai-catalog and api-catalog point only at real resources", () => {
  const cat = JSON.parse(rd(".well-known/ai-catalog.json"));
  assert.equal(cat.specVersion, "1.0");
  for (const e of cat.entries) {
    assert.ok(e.identifier.startsWith("urn:air:"));
    assert.ok(("url" in e) !== ("data" in e));
  }
  const ls = JSON.parse(rd(".well-known/api-catalog")).linkset[0];
  assert.equal(ls["service-desc"][0].href, "https://agentic.lvlltd.com/api/openapi.json");
  assert.equal(ls.status[0].href, "https://agentic.lvlltd.com/api/health");
  // the API really serves those paths
  const market = fs.readFileSync(path.join(root, "api/market.js"), "utf8");
  assert.match(market, /"\/api\/openapi\.json"===f/);
  assert.match(market, /"\/api\/health"===f/);
});

test("markdown twins, Link header and WebMCP are wired", () => {
  for (const f of ["index.md", "buy.md", "llms.txt"]) assert.match(rd(f), /^(---|# )/);
  const v = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const home = v.headers.find((h) => h.source === "/");
  const link = home.headers.find((h) => h.key === "Link").value;
  for (const rel of ["api-catalog", "service-desc", "describedby"]) assert.match(link, new RegExp(`rel="${rel}"`));
  const mw = fs.readFileSync(path.join(root, "middleware.js"), "utf8");
  assert.match(mw, /matcher: \['\/', '\/buy'\]/);
  assert.match(mw, /text\/markdown; charset=utf-8/);
  for (const h of ["index.html", "buy.html"]) {
    assert.match(rd(h), /src="\/webmcp\.js"/);
    assert.equal(rd(h), fs.readFileSync(path.join(root, h), "utf8"), `${h} root and public copies match`);
  }
  assert.match(rd("webmcp.js"), /registerTool/);
});
