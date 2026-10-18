import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";
import handler from "../api/index.js";
import card from "../api/agent-card.json";
createServer((req, res) => handler(req, res)).listen(8080);
const node = httpServerHandler({ port: 8080 });
const body = JSON.stringify(card, null, 2);
export default {
  fetch(request, env, ctx) {
    const p = new URL(request.url).pathname;
    if ((p === "/agent-card.json" || p === "/.well-known/agent-card.json") && (request.method === "GET" || request.method === "HEAD"))
      return new Response(request.method === "HEAD" ? null : body, { headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
    return node.fetch(request, env, ctx);
  },
};
