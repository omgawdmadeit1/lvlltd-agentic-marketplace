"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const handler = require("../api/index");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  res.statusCode = 200;
  res.setHeader("content-type", TYPES[ext] || "application/octet-stream");
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/buy/success") {
    handler(req, res);
    return;
  }
  let pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  if (pathname === "/buy") pathname = "/buy.html";
  const candidates = [path.join(PUBLIC, pathname), path.join(ROOT, pathname)];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!filePath) {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("not found");
    return;
  }
  sendFile(res, filePath);
});

server.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(`local storefront http://127.0.0.1:${PORT}  (Stripe live buy at /buy)\n`);
});
