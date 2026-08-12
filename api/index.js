const FEE = 0.033;
const fee = (n) => Math.round(n * FEE * 1e6) / 1e6;
const uid = (p) => p + "_" + Math.random().toString(36).slice(2, 8);
const skills = [
  { id: "skill_price_watcher", name: "Price Watcher", priceUsdc: 4.5, isPublic: true, description: "Alerts on auction price moves", category: "market" },
  { id: "skill_sniper", name: "Bid Sniper", priceUsdc: 9, isPublic: true, description: "Last-second bid assist", category: "auction" },
  { id: "skill_bargain_coach", name: "Bargain Coach", priceUsdc: 6.5, isPublic: true, description: "Offer strategy hints", category: "bargain" },
  { id: "skill_catalog_radar", name: "Catalog Radar", priceUsdc: 3, isPublic: true, description: "Surfaces new listings fast", category: "discovery" },
  { id: "skill_risk_guard", name: "Risk Guard", priceUsdc: 5.5, isPublic: true, description: "Caps overbid exposure", category: "risk" },
];
function seed() {
  const listings = [
    { id: "lst_dataset_alpha", title: "Alpha Dataset Pack", description: "Curated agent training traces", type: "digital", pricingMode: "english_auction", priceUsdc: 10, status: "active", sellerId: "seller_a", createdAt: new Date().toISOString() },
    { id: "lst_prompt_kit", title: "Prompt Kit Pro", description: "Battle-tested prompt library", type: "digital", pricingMode: "fixed", priceUsdc: 18, status: "active", sellerId: "seller_b", createdAt: new Date().toISOString() },
    { id: "lst_sensor_node", title: "Sensor Node (physical)", description: "Ships externally", type: "physical", pricingMode: "fixed", priceUsdc: 42, status: "active", sellerId: "seller_c", createdAt: new Date().toISOString() },
    { id: "lst_barter_slot", title: "Compute Barter Slot", description: "Trade GPU hours", type: "digital", pricingMode: "bargain", priceUsdc: 15, status: "active", sellerId: "seller_a", createdAt: new Date().toISOString() },
    { id: "lst_vickrey_lot", title: "Silent Lot - Model Weights", description: "Vickrey sealed bid", type: "digital", pricingMode: "vickrey_auction", priceUsdc: 25, status: "active", sellerId: "seller_b", createdAt: new Date().toISOString() },
  ];
  const auctions = [
    { id: "auc_dataset_alpha", listingId: "lst_dataset_alpha", status: "open", highBidUsdc: 11.5, minIncrementUsdc: 0.5, endsAt: new Date(Date.now() + 864e5).toISOString() },
    { id: "auc_vickrey_lot", listingId: "lst_vickrey_lot", status: "open", highBidUsdc: 0, minIncrementUsdc: 1, endsAt: new Date(Date.now() + 1728e5).toISOString(), kind: "vickrey" },
  ];
  return { listings, auctions, bids: [], orders: [], ownedSkillIds: [] };
}
const g = globalThis;
function S() {
  if (!g.__lvl) {
    const s = seed();
    g.__lvl = { me: { id: "agent_demo_you", name: "Your Grok Bot", balanceUsdc: 250, equippedSkills: [] }, skills: skills.slice(), ...s };
  }
  return g.__lvl;
}
function me() {
  const s = S();
  return { ...s.me, balance_usdc: s.me.balanceUsdc, equipped_skills: s.me.equippedSkills, owned_skill_ids: s.ownedSkillIds.slice() };
}
const ACTIONS = [
  { name: "get_marketplace_description", method: "GET", path: "/api/agent" },
  { name: "get_action_catalog", method: "GET", path: "/api/actions" },
  { name: "get_me", method: "GET", path: "/api/me" },
  { name: "list_open_auctions", method: "GET", path: "/api/auctions" },
  { name: "create_listing", method: "POST", path: "/api/listings" },
  { name: "purchase_listing", method: "POST", path: "/api/listings/{id}/purchase" },
  { name: "place_bid", method: "POST", path: "/api/auctions/{id}/bids" },
  { name: "close_auction", method: "POST", path: "/api/auctions/{id}/close" },
  { name: "get_skill_catalog", method: "GET", path: "/api/skills" },
  { name: "purchase_skill", method: "POST", path: "/api/skills/{id}/purchase" },
  { name: "equip_skill", method: "POST", path: "/api/agents/me/skills/equip" },
  { name: "unequip_skill", method: "POST", path: "/api/agents/me/skills/unequip" },
  { name: "get_my_orders", method: "GET", path: "/api/orders" },
];
function send(res, code, data) {
  const b = JSON.stringify(data, null, 2);
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization, x-agent-id, x-payment");
  res.end(b);
}
function readBody(req) {
  return new Promise((resolve) => {
    const c = [];
    req.on("data", (d) => c.push(d));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(c).toString() || "{}")); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}
function openA() {
  const s = S();
  return s.auctions.filter((a) => a.status === "open").map((a) => {
    const l = s.listings.find((x) => x.id === a.listingId);
    return l ? { ...a, listing: l, title: l.title, description: l.description, auction_type: a.kind || "english", current_high_bid: a.highBidUsdc, highBidUsdc: a.highBidUsdc } : null;
  }).filter(Boolean);
}
module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type, authorization, x-agent-id, x-payment");
      return res.end();
    }
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", "https://" + host);
    let path = url.pathname || "/";
    if (!path.startsWith("/api")) return send(res, 404, { ok: false, error: "not_an_api_route", hint: "Human UI is at /. Agent entry is GET /api/agent" });
    if (path === "/api/index" || path === "/api/index.js") path = "/api/agent";
    const m = (req.method || "GET").toUpperCase();
    const b = m === "POST" ? await readBody(req) : {};
    const s = S();
    if (m === "GET" && (path === "/api/agent" || path === "/api")) {
      return send(res, 200, {
        name: "LVL - Agentic Marketplace", domain: "agentic.lvlltd.com", version: "1.4.0",
        fee_rate: FEE, fee_note: "3.3% platform fee on internal trades and skill purchases",
        surfaces: { human: "Conversation-first progressive UI", agent: "Self-describing machine interface" },
        market_mechanisms: ["english_auction", "vickrey_auction", "fixed_price", "bargain", "trade_barter", "price_matching"],
        fulfillment: { digital: "platform", physical: "external" },
        skills: { public_count: skills.length, preserved_247_hidden: 247 },
        stats: { open_auctions: openA().length, active_listings: s.listings.filter((l) => l.status === "active").length, orders: s.orders.length, balance_usdc: s.me.balanceUsdc },
        first_contact: { step_1: "GET /api/agent", step_2: "GET /api/actions", step_3: "POST /api/auctions/{id}/bids | POST /api/listings/{id}/purchase | GET /api/me" },
        bot_entry: "/api/agent", next_actions: ACTIONS.map((a) => a.name), ok: true,
      });
    }
    if (m === "GET" && path === "/api/actions") return send(res, 200, { actions: ACTIONS, fee_rate: FEE });
    if (m === "GET" && path === "/api/openapi.json") return send(res, 200, { openapi: "3.1.0", info: { title: "LVL Agentic Marketplace", version: "1.4.0" }, paths: Object.fromEntries(ACTIONS.map((a) => [a.path.split("?")[0], { [a.method.toLowerCase()]: { summary: a.name } }])) });
    if (m === "GET" && path === "/api/me") return send(res, 200, { ok: true, me: me(), balance_usdc: s.me.balanceUsdc });
    if (m === "GET" && path === "/api/auctions") return send(res, 200, { auctions: openA(), fee_rate: FEE });
    if (m === "GET" && path === "/api/listings") return send(res, 200, { listings: s.listings.filter((l) => l.status === "active") });
    if (m === "POST" && path === "/api/listings") {
      const title = String(b.title || "").trim();
      const price = Number(b.price_usdc);
      if (!title || !(price > 0)) return send(res, 400, { ok: false, error: "invalid_listing" });
      const listing = { id: uid("lst"), title, description: b.description || title, type: b.type || "digital", pricingMode: b.pricing_mode || "fixed", priceUsdc: price, status: "active", sellerId: s.me.id, createdAt: new Date().toISOString() };
      s.listings.unshift(listing);
      s.orders.unshift({ id: uid("ord"), kind: "listing_created", listingId: listing.id, amountUsdc: price, feeUsdc: fee(price), status: "listed", createdAt: new Date().toISOString() });
      return send(res, 200, { ok: true, listing, fee_estimate_usdc: fee(price) });
    }
    const bid = path.match(/^\/api\/auctions\/([^/]+)\/bids$/);
    if (m === "POST" && bid) {
      const a = s.auctions.find((x) => x.id === bid[1]);
      if (!a || a.status !== "open") return send(res, 404, { ok: false, error: "auction_not_found" });
      const amount = Number(b.amount_usdc);
      const min = (a.highBidUsdc || 0) + (a.minIncrementUsdc || 0.5);
      if (!(amount >= min)) return send(res, 400, { ok: false, error: "invalid_bid", min_amount_usdc: min });
      a.highBidUsdc = amount;
      const bd = { id: uid("bid"), auctionId: a.id, amountUsdc: amount, agentId: s.me.id, createdAt: new Date().toISOString() };
      s.bids.unshift(bd);
      return send(res, 200, { ok: true, bid: bd, auction: a, fee_if_won: fee(amount) });
    }
    const close = path.match(/^\/api\/auctions\/([^/]+)\/close$/);
    if (m === "POST" && close) {
      const a = s.auctions.find((x) => x.id === close[1]);
      if (!a) return send(res, 404, { ok: false, error: "auction_not_found" });
      a.status = "closed";
      return send(res, 200, { ok: true, auction: a });
    }
    const buyL = path.match(/^\/api\/listings\/([^/]+)\/purchase$/);
    if (m === "POST" && buyL) {
      const l = s.listings.find((x) => x.id === buyL[1] && x.status === "active");
      if (!l) return send(res, 404, { ok: false, error: "listing_not_found" });
      const f = fee(l.priceUsdc);
      const total = l.priceUsdc + f;
      if (s.me.balanceUsdc < total) return send(res, 400, { ok: false, error: "insufficient_balance", need: total, balance_usdc: s.me.balanceUsdc });
      s.me.balanceUsdc = Math.round((s.me.balanceUsdc - total) * 100) / 100;
      l.status = "sold";
      const o = { id: uid("ord"), kind: "listing_purchase", listingId: l.id, amountUsdc: l.priceUsdc, feeUsdc: f, status: "paid", createdAt: new Date().toISOString() };
      s.orders.unshift(o);
      return send(res, 200, { ok: true, order: o, balance_usdc: s.me.balanceUsdc });
    }
    if (m === "GET" && path === "/api/skills") {
      return send(res, 200, {
        skills: s.skills.filter((x) => x.isPublic).map((x) => ({ ...x, price_usdc: x.priceUsdc, owned: s.ownedSkillIds.includes(x.id), equipped: s.me.equippedSkills.includes(x.id) })),
        hidden_preserved_247: 247, owned_skill_ids: s.ownedSkillIds.slice(), equipped_skills: s.me.equippedSkills.slice(),
      });
    }
    const buyS = path.match(/^\/api\/skills\/([^/]+)\/purchase$/);
    if (m === "POST" && buyS) {
      const sk = s.skills.find((x) => x.id === buyS[1] && x.isPublic);
      if (!sk) return send(res, 404, { ok: false, error: "skill_not_found" });
      if (s.ownedSkillIds.includes(sk.id)) return send(res, 200, { ok: true, already_owned: true, balance_usdc: s.me.balanceUsdc, skill_id: sk.id });
      const f = fee(sk.priceUsdc);
      const total = sk.priceUsdc + f;
      if (s.me.balanceUsdc < total) return send(res, 400, { ok: false, error: "insufficient_balance", need: total, balance_usdc: s.me.balanceUsdc });
      s.me.balanceUsdc = Math.round((s.me.balanceUsdc - total) * 100) / 100;
      s.ownedSkillIds.push(sk.id);
      const o = { id: uid("ord"), kind: "skill_purchase", skillId: sk.id, amountUsdc: sk.priceUsdc, feeUsdc: f, status: "paid", createdAt: new Date().toISOString() };
      s.orders.unshift(o);
      return send(res, 200, { ok: true, order: o, balance_usdc: s.me.balanceUsdc, owned_skill_ids: s.ownedSkillIds });
    }
    if (m === "POST" && path === "/api/agents/me/skills/equip") {
      const id = b.skill_id;
      if (!id) return send(res, 400, { ok: false, error: "skill_id_required" });
      if (!s.ownedSkillIds.includes(id)) return send(res, 400, { ok: false, error: "not_owned" });
      if (!s.me.equippedSkills.includes(id)) s.me.equippedSkills.push(id);
      return send(res, 200, { ok: true, equipped: s.me.equippedSkills, me: me() });
    }
    if (m === "POST" && path === "/api/agents/me/skills/unequip") {
      const id = b.skill_id;
      if (!id) return send(res, 400, { ok: false, error: "skill_id_required" });
      s.me.equippedSkills = s.me.equippedSkills.filter((x) => x !== id);
      return send(res, 200, { ok: true, equipped: s.me.equippedSkills, me: me() });
    }
    if (m === "GET" && path === "/api/orders") {
      return send(res, 200, {
        orders: s.orders.map((o) => ({ ...o, amount_usdc: o.amountUsdc, platform_fee_usdc: o.feeUsdc, status: o.status || "paid" })),
        balance_usdc: s.me.balanceUsdc, me: me(),
      });
    }
    if (m === "GET" && path === "/api/health") return send(res, 200, { ok: true, service: "LVL Agentic Marketplace", version: "1.4.0", bot_entry: "/api/agent" });
    return send(res, 404, { ok: false, error: "not_found", path, hint: "GET /api/agent" });
  } catch (e) {
    return send(res, 500, { ok: false, error: "internal", message: String(e && e.message ? e.message : e) });
  }
};
