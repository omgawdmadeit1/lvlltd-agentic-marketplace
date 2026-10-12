// /buy is a public product page: it must be indexable (no robots noindex meta, no X-Robots-Tag, no robots.txt block).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const rd = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("buy.html and public/buy.html carry no robots noindex meta", () => {
  for (const rel of ["buy.html", "public/buy.html"]) {
    const html = rd(rel);
    assert.doesNotMatch(html, /<meta[^>]+name=["']robots["'][^>]*noindex/i, rel);
    assert.doesNotMatch(html, /<meta[^>]+name=["']googlebot["'][^>]*noindex/i, rel);
  }
  assert.equal(rd("buy.html"), rd("public/buy.html"), "the two /buy copies stay identical");
});

test("vercel.json sets no X-Robots-Tag and no robots.txt disallows /buy", () => {
  assert.doesNotMatch(rd("vercel.json"), /x-robots-tag/i);
  for (const rel of ["robots.txt", "public/robots.txt"]) {
    if (fs.existsSync(path.join(root, rel))) assert.doesNotMatch(rd(rel), /^\s*Disallow:\s*\/buy\b/im, rel);
  }
});
