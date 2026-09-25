"use strict";

/**
 * Sealed v2.1 pack map for the two LIVE Stripe SKUs.
 *
 * Source of truth: private repo omgawdmadeit1/lvlltd-agent-marketplace,
 * goods/sealed/<pack_id>/ pinned to commit 40a49f1 (full SHA below).
 * content_sha256 values equal https://lvlltd.com/api/packs and the pinned
 * goods/sealed/manifest.json. They are recomputed on every fetch and the
 * pack is NOT served if they differ (fail closed, never invented).
 *
 * Files are fetched server-side via the GitHub contents API with a read-only
 * token (DELIVERY_GITHUB_TOKEN). They are never vendored into this public repo.
 */

const crypto = require("crypto");

const PACK_SOURCE = Object.freeze({
  repo: "omgawdmadeit1/lvlltd-agent-marketplace",
  commit: "40a49f117e543f11e53d9b106f74221edf9c3445",
  base_path: "goods/sealed",
});

// Order matches goods/sealed/<id>/pack-files.json at the pinned commit.
const PACK_FILES = Object.freeze([
  "package.json",
  "SKILL.md",
  "README.md",
  "detail.md",
  "LICENSE.md",
  "agent-install.json",
  "pack-files.json",
  "src/index.js",
  "src/tools.js",
  "src/runbook.js",
  "schemas/output.schema.json",
]);

// Excluded from content_sha256 by scripts/build-sealed-packs.mjs.
const HASH_EXCLUDED = Object.freeze(["pack-files.json", "agent-install.json"]);

const DELIVERY_PACKS = Object.freeze({
  "lvl-x402-merchant-os": Object.freeze({
    sku: "lvl-x402-merchant-os",
    price_id: "price_1UFmzKE9E4WCqx1QjoXF3BMO",
    pack_id: "x402-merchant-operating-system",
    version: "2.1",
    content_sha256: "3e1c3e1814a28f09190119b1b8ff1d34745cbdbc8cfdcfe2b7868678601f116d",
  }),
  "lvl-cold-start-catalog-bootstrapper": Object.freeze({
    sku: "lvl-cold-start-catalog-bootstrapper",
    price_id: "price_1UFmzME9E4WCqx1QkzHC4R5h",
    pack_id: "cold-start-catalog-bootstrapper",
    version: "2.1",
    content_sha256: "9f2780f01e977dff975d1f38f118c72f934514f91cd5ee6f7dd608bb9c523607",
  }),
});

function packForSku(sku) {
  const key = String(sku || "").trim();
  return Object.prototype.hasOwnProperty.call(DELIVERY_PACKS, key) ? DELIVERY_PACKS[key] : null;
}

/** Same algorithm as scripts/build-sealed-packs.mjs (content_sha256). */
function packContentSha256(files) {
  const blob = PACK_FILES.filter((f) => !HASH_EXCLUDED.includes(f))
    .map((f) => (typeof files[f] === "string" ? files[f] : ""))
    .join("\n");
  return crypto.createHash("sha256").update(blob, "utf8").digest("hex");
}

const cache = new Map();

async function fetchPackFile(token, pack, file) {
  const path = `${PACK_SOURCE.base_path}/${pack.pack_id}/${file}`
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const url = `https://api.github.com/repos/${PACK_SOURCE.repo}/contents/${path}?ref=${PACK_SOURCE.commit}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw",
      "User-Agent": "lvlltd-agentic-delivery",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    const error = new Error(`pack_source_http_${response.status}`);
    error.code = "pack_source_unavailable";
    throw error;
  }
  return response.text();
}

/**
 * Load and verify a pack. Throws with code unknown_sku, pack_source_unconfigured,
 * pack_source_unavailable, or pack_hash_mismatch. Never returns unverified files.
 */
async function loadVerifiedPack(sku, env) {
  const pack = packForSku(sku);
  if (!pack) {
    const error = new Error("unknown sku");
    error.code = "unknown_sku";
    throw error;
  }
  if (cache.has(pack.sku)) return cache.get(pack.sku);
  const source = env || process.env;
  const token = String(source.DELIVERY_GITHUB_TOKEN || "").trim();
  if (!token) {
    const error = new Error("DELIVERY_GITHUB_TOKEN is not set");
    error.code = "pack_source_unconfigured";
    throw error;
  }
  const files = {};
  for (const file of PACK_FILES) {
    files[file] = await fetchPackFile(token, pack, file);
  }
  const actual = packContentSha256(files);
  if (actual !== pack.content_sha256) {
    const error = new Error("pack hash mismatch");
    error.code = "pack_hash_mismatch";
    error.actual = actual;
    throw error;
  }
  const verified = Object.freeze({
    sku: pack.sku,
    pack_id: pack.pack_id,
    version: pack.version,
    content_sha256: actual,
    source: { repo: PACK_SOURCE.repo, commit: PACK_SOURCE.commit },
    files: Object.freeze(files),
  });
  // Content at a pinned commit is immutable, so caching per warm instance is safe.
  cache.set(pack.sku, verified);
  return verified;
}

function clearPackCache() {
  cache.clear();
}

module.exports = {
  PACK_SOURCE,
  PACK_FILES,
  HASH_EXCLUDED,
  DELIVERY_PACKS,
  packForSku,
  packContentSha256,
  loadVerifiedPack,
  clearPackCache,
};
