const FEE = 0.033;
const fee = (n) => Math.round(Number(n) * FEE * 1e6) / 1e6;
const uid = (p) => p + "_" + Math.random().toString(36).slice(2, 10);
const VERSION = "1.7.0";
const PUBLIC_SKILLS = [
  { id: "skill_price_watcher", name: "Price Watcher", priceUsdc: 4.5, isPublic: true, description: "Alerts on auction price moves", category: "market" },
  { id: "skill_sniper", name: "Bid Sniper", priceUsdc: 9.0, isPublic: true, description: "Last-second bid assist", category: "auction" },
  { id: "skill_bargain_coach", name: "Bargain Coach", priceUsdc: 6.5, isPublic: true, description: "Offer strategy hints", category: "bargain" },
  { id: "skill_catalog_radar", name: "Catalog Radar", priceUsdc: 3.0, isPublic: true, description: "Surfaces new listings fast", category: "discovery" },
  { id: "skill_risk_guard", name: "Risk Guard", priceUsdc: 5.5, isPublic: true, description: "Caps overbid exposure", category: "risk" },
];
function seed() {
  const now = Date.now();
  const listings = [
    { id: "lst_dataset_alpha", title: "Alpha Dataset Pack", description: "Curated agent training traces", type: "digital", pricingMode: "english_auction", priceUsdc: 10, status: "active", sellerId: "seller_a", createdAt: new Date(now).toISOString() },
    { id: "lst_prompt_kit", title: "Prompt Kit Pro", description: "Battle-tested prompt library", type: "digital", pricingMode: "fixed", priceUsdc: 18, status: "active", sellerId: "seller_b", createdAt: new Date(now).toISOString() },
    { id: "lst_sensor_node", title: "Sensor Node (physical)", description: "Ships externally", type: "physical", pricingMode: "fixed", priceUsdc: 42, status: "active", sellerId: "seller_c", createdAt: new Date(now).toISOString() },
    { id: "lst_barter_slot", title: "Compute Barter Slot", description: "Trade GPU hours", type: "digital", pricingMode: "bargain", priceUsdc: 15, status: "active", sellerId: "seller_a", createdAt: new Date(now).toISOString() },
    { id: "lst_vickrey_lot", title: "Silent Lot — Model Weights", description: "Vickrey sealed bid", type: "digital", pricingMode: "vickrey_auction", priceUsdc: 25, status: "active", sellerId: "seller_b", createdAt: new Date(now).toISOString() },
    { id: "lst_flash_lot", title: "Flash Lot — Embedding Cache", description: "Short English auction for lifecycle demos", type: "digital", pricingMode: "english_auction", priceUsdc: 5, status: "active", sellerId: "seller_a", createdAt: new Date(now).toISOString() },
  ];
  const auctions = [
    { id: "auc_dataset_alpha", listingId: "lst_dataset_alpha", status: "open", highBidUsdc: 11.5, highBidderId: "agent_seed", minIncrementUsdc: 0.5, reserveUsdc: 10, endsAt: new Date(now + 864e5).toISOString(), kind: "english" },
    { id: "auc_vickrey_lot", listingId: "lst_vickrey_lot", status: "open", highBidUsdc: 0, highBidderId: null, minIncrementUsdc: 1, reserveUsdc: 25, endsAt: new Date(now + 1728e5).toISOString(), kind: "vickrey", sealed: true },
    { id: "auc_flash_lot", listingId: "lst_flash_lot", status: "open", highBidUsdc: 5.5, highBidderId: "agent_seed", minIncrementUsdc: 0.25, reserveUsdc: 5, endsAt: new Date(now + 180e3).toISOString(), kind: "english" },
  ];
  return {
    listings,
    auctions,
    bids: [],
    orders: [],
    ownedSkillIds: [],
    me: { id: "agent_demo_you", name: "Your Grok Bot", balanceUsdc: 250, equippedSkills: [], skillConfigs: {} },
    skills: PUBLIC_SKILLS.slice(),
    startedAt: now,
  };
}
const g = globalThis;
function S() {
  if (!g.__lvl_v17) g.__lvl_v17 = seed();
  return g.__lvl_v17;
}
function meView(s) {
  return {
    ...s.me,
    balance_usdc: s.me.balanceUsdc,
    ownedSkillIds: s.ownedSkillIds.slice(),
    owned_skill_ids: s.ownedSkillIds.slice(),
    equippedSkills: s.me.equippedSkills.slice(),
    equipped_skills: s.me.equippedSkills.slice(),
    fee_rate: FEE,
  };
}
function paymentStub(amountUsdc, orderId) {
  const feeUsdc = fee(amountUsdc);
  const total = Math.round((amountUsdc + feeUsdc) * 1e6) / 1e6;
  return {
    payment_request_id: uid("pr"),
    order_id: orderId || null,
    status: "stub_ready",
    rail: { kind: "x402", chain: "base", asset: "USDC", status: "stub" },
    amount: { asset: "USDC", decimals: 6, micros: Math.round(total * 1e6), usdc: total },
    line_items: [
      { code: "purchase_price", micros: Math.round(amountUsdc * 1e6), usdc: amountUsdc },
      { code: "platform_fee", rate_bps: 330, micros: Math.round(feeUsdc * 1e6), usdc: feeUsdc },
    ],
    note: "Demo wallet is debited immediately; x402 Base USDC is stub until wired.",
  };
}
function tickAuctions(s) {
  const now = Date.now();
  for (const a of s.auctions) {
    if (a.status !== "open") continue;
    if (new Date(a.endsAt).getTime() <= now) {
      closeAuction(s, a, "expired");
    }
  }
}
function closeAuction(s, a, reason) {
  if (a.status !== "open") return a;
  const sealed = !!a.sealed || a.kind === "vickrey";
  const high = Number(a.highBidUsdc || 0);
  const reserve = Number(a.reserveUsdc || 0);
  if (high >= reserve && a.highBidderId) {
    a.status = "cleared";
    a.closeReason = reason || "cleared";
    a.clearPriceUsdc = high;
    a.winnerId = a.highBidderId;
    const listing = s.listings.find((l) => l.id === a.listingId);
    if (listing) listing.status = "sold";
    if (a.highBidderId === s.me.id) {
      const f = fee(high);
      const total = high + f;
      if (s.me.balanceUsdc >= total) {
        s.me.balanceUsdc = Math.round((s.me.balanceUsdc - total) * 100) / 100;
        const order = {
          id: uid("ord"),
          kind: "auction_win",
          auctionId: a.id,
          listingId: a.listingId,
          title: listing ? listing.title : a.id,
          amountUsdc: high,
          feeUsdc: f,
          total_usdc: total,
          status: "paid",
          fulfillment: { kind: listing && listing.type === "physical" ? "external" : "platform", status: "settled" },
          payment_request: paymentStub(high, null),
          createdAt: new Date().toISOString(),
        };
        order.payment_request.order_id = order.id;
        s.orders.unshift(order);
        a._lastOrder = order;
      }
    }
  } else {
    a.status = "closed";
    a.closeReason = reason || (high < reserve ? "reserve_not_met" : "no_bids");
    a.winnerId = null;
  }
  return a;
}
function openAuctions(s) {
  tickAuctions(s);
  const now = Date.now();
  return s.auctions
    .map((a) => {
      const l = s.listings.find((x) => x.id === a.listingId);
      if (!l) return null;
      const ends = new Date(a.endsAt).getTime();
      const sec = Math.max(0, Math.floor((ends - now) / 1000));
      const sealed = !!a.sealed || a.kind === "vickrey";
      return {
        ...a,
        listing: l,
        title: l.title,
        description: l.description,
        auction_type: a.kind || "english",
        current_high_bid: sealed ? null : a.highBidUsdc,
        highBidUsdc: sealed ? undefined : a.highBidUsdc,
        sealed,
        seconds_remaining: a.status === "open" ? sec : 0,
        closing_soon: a.status === "open" && sec > 0 && sec <= 120,
      };
    })
    .filter(Boolean);
}
const ACTIONS = [
  { name: "get_marketplace_description", method: "GET", path: "/api/agent", description: "Start here — self-describing root" },
  { name: "get_openapi", method: "GET", path: "/api/openapi.json", description: "Full OpenAPI 3.1" },
  { name: "get_action_catalog", method: "GET", path: "/api/actions" },
  { name: "get_me", method: "GET", path: "/api/me" },
  { name: "list_auctions", method: "GET", path: "/api/auctions?status=open" },
  { name: "place_bid", method: "POST", path: "/api/auctions/{id}/bids", body: { amount_usdc: "number" } },
  { name: "close_auction", method: "POST", path: "/api/auctions/{id}/close", body: { force: "boolean?" } },
  { name: "list_listings", method: "GET", path: "/api/listings" },
  { name: "create_listing", method: "POST", path: "/api/listings", body: { title: "string", price_usdc: "number" } },
  { name: "purchase_listing", method: "POST", path: "/api/listings/{id}/purchase" },
  { name: "get_skill_catalog", method: "GET", path: "/api/skills" },
  { name: "purchase_skill", method: "POST", path: "/api/skills/{id}/purchase" },
  { name: "equip_skill", method: "POST", path: "/api/agents/me/skills/equip", body: { skill_id: "string" } },
  { name: "unequip_skill", method: "POST", path: "/api/agents/me/skills/unequip", body: { skill_id: "string" } },
  { name: "get_my_orders", method: "GET", path: "/api/orders" },
  { name: "get_x402_rail", method: "GET", path: "/api/payments/x402" },
  { name: "quote_x402", method: "POST", path: "/api/payments/x402/quote", body: { amount_usdc: "number" } },
  { name: "confirm_x402", method: "POST", path: "/api/payments/x402/confirm", body: { payment_request_id: "string" } },
];
function openapiDoc() {
  const paths = {};
  for (const a of ACTIONS) {
    const p = a.path.split("?")[0];
    if (!paths[p]) paths[p] = {};
    paths[p][a.method.toLowerCase()] = {
      operationId: a.name,
      summary: a.description || a.name,
      tags: p.includes("payment") ? ["Payments"] : p.includes("skill") || p.includes("agents") ? ["Skills"] : p.includes("auction") || p.includes("listing") ? ["Market"] : p.includes("me") || p.includes("order") ? ["Account"] : ["Discovery"],
    };
  }
  paths["/api/health"] = { get: { operationId: "health", summary: "Health", tags: ["Discovery"] } };
  return {
    openapi: "3.1.0",
    info: {
      title: "LVL Agentic Marketplace",
      version: VERSION,
      summary: "Dual-interface agentic marketplace — machine surface under /api/* only",
      description: "Humans use GET /. Agents use GET /api/agent then this OpenAPI. Platform fee 3.3% (330 bps). Payments: x402 / USDC on Base (stubbed). Orchestrator v2 available in human Agent panel.",
      contact: { url: "https://agentic.lvlltd.com" },
    },
    servers: [{ url: "https://agentic.lvlltd.com", description: "Production" }],
    tags: [{ name: "Discovery" }, { name: "Account" }, { name: "Market" }, { name: "Skills" }, { name: "Payments" }],
    paths,
  };
}
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
module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type, authorization, x-agent-id, x-payment");
      return res.end();
    }
    const host = req.headers.host || "agentic.lvlltd.com";
    const url = new URL(req.url || "/", "https://" + host);
    let path = url.pathname || "/";
    if (!path.startsWith("/api")) {
      return send(res, 404, { error: "not_an_api_route", hint: "Human UI is at /. Agent entry is GET /api/agent" });
    }
    if (path === "/api/index" || path === "/api/index.js") path = "/api/agent";
    const m = (req.method || "GET").toUpperCase();
    const b = m === "POST" ? await readBody(req) : {};
    const s = S();
    tickAuctions(s);
    const open = openAuctions(s);
    if (m === "GET" && (path === "/api/agent" || path === "/api")) {
      return send(res, 200, {
        name: "LVL — Agentic Marketplace",
        domain: "agentic.lvlltd.com",
        version: VERSION,
        fee_rate: FEE,
        fee_note: "3.3% platform fee on internal trades and skill purchases",
        surfaces: {
          human: "Conversation-first progressive UI + Orchestrator v2 panel",
          agent: "Self-describing machine interface",
        },
        market_mechanisms: ["english_auction", "vickrey_auction", "fixed_price", "bargain", "trade_barter", "price_matching"],
        fulfillment: { digital: "platform", physical: "external" },
        skills: { public_count: PUBLIC_SKILLS.length, preserved_247_hidden: 247 },
        stats: {
          open_auctions: open.filter((a) => a.status === "open").length,
          active_listings: s.listings.filter((l) => l.status === "active").length,
          orders: s.orders.length,
          balance_usdc: s.me.balanceUsdc,
        },
        first_contact: {
          summary: "Discover → inspect OpenAPI → act → pay (stub)",
          steps: [
            { n: 1, method: "GET", path: "/api/agent", why: "Self-describing marketplace root (this document)" },
            { n: 2, method: "GET", path: "/api/openapi.json", why: "Schemas, params, and payment stubs" },
            { n: 3, method: "GET", path: "/api/actions", why: "Compact action catalog" },
            { n: 4, method: "GET", path: "/api/me", why: "Demo balance + equipped skills" },
            { n: 5, method: "GET", path: "/api/auctions?status=open", why: "See live market" },
            { n: 6, method: "POST", path: "/api/auctions/{id}/bids", body: { amount_usdc: 12 }, why: "Place a bid" },
            { n: 7, method: "GET", path: "/api/payments/x402", why: "Payment rail: x402 / USDC / Base (stub)" },
          ],
          step_1: "GET /api/agent",
          step_2: "GET /api/openapi.json",
          step_3: "GET /api/actions → act (bids/purchase) → GET /api/payments/x402",
          cors: "Access-Control-Allow-Origin: * on /api/*",
          human_ui: "https://agentic.lvlltd.com/ (never JSON)",
        },
        payments: {
          rail: { kind: "x402", chain: "base", asset: "USDC", status: "stub" },
          fee_rate_bps: 330,
          note: "x402 / USDC on Base is designed; demo wallet debit is the stub until wired.",
        },
        orchestrator: {
          version: "v2",
          human_panel: "Agent tab",
          prompts: ["tight", "json", "full"],
          public_lvl: { a2a: "https://lvlltd.com/api/a2a", pay: "https://lvlltd.com/api/pay", proof: "https://lvlltd.com/api/proof" },
        },
        openapi: "/api/openapi.json",
        bot_entry: "/api/agent",
        next_actions: ACTIONS.map((a) => a.name),
        ok: true,
      });
    }
    if (m === "GET" && path === "/api/actions") return send(res, 200, { actions: ACTIONS, fee_rate: FEE, version: VERSION });
    if (m === "GET" && path === "/api/openapi.json") return send(res, 200, openapiDoc());
    if (m === "GET" && path === "/api/health") return send(res, 200, { ok: true, service: "LVL Agentic Marketplace", version: VERSION, bot_entry: "/api/agent" });
    if (m === "GET" && path === "/api/me") return send(res, 200, { ok: true, me: meView(s) });
    if (m === "GET" && path === "/api/auctions") {
      let list = open;
      const st = url.searchParams.get("status");
      if (st === "open") list = open.filter((a) => a.status === "open");
      else if (st === "closed") list = open.filter((a) => a.status !== "open");
      return send(res, 200, { auctions: list, fee_rate: FEE });
    }
    if (m === "GET" && path === "/api/listings") {
      return send(res, 200, { listings: s.listings.filter((l) => l.status === "active" || true) });
    }
    if (m === "POST" && path === "/api/listings") {
      const title = String(b.title || "").trim();
      const price = Number(b.price_usdc);
      if (!title || !(price > 0)) return send(res, 400, { ok: false, error: "invalid_listing" });
      const pricingMode = b.pricing_mode || "fixed";
      const listing = {
        id: uid("lst"),
        title,
        description: b.description || title,
        type: b.type || "digital",
        pricingMode,
        priceUsdc: price,
        status: "active",
        sellerId: s.me.id,
        createdAt: new Date().toISOString(),
      };
      s.listings.unshift(listing);
      if (pricingMode === "english_auction" || pricingMode === "vickrey_auction") {
        s.auctions.unshift({
          id: uid("auc"),
          listingId: listing.id,
          status: "open",
          highBidUsdc: 0,
          highBidderId: null,
          minIncrementUsdc: pricingMode === "vickrey_auction" ? 1 : 0.5,
          reserveUsdc: price,
          endsAt: new Date(Date.now() + 864e5).toISOString(),
          kind: pricingMode === "vickrey_auction" ? "vickrey" : "english",
          sealed: pricingMode === "vickrey_auction",
        });
      }
      s.orders.unshift({
        id: uid("ord"),
        kind: "listing_created",
        listingId: listing.id,
        title,
        amountUsdc: price,
        feeUsdc: fee(price),
        total_usdc: price,
        status: "listed",
        fulfillment: { kind: "platform", status: "listed" },
        createdAt: new Date().toISOString(),
      });
      return send(res, 200, { ok: true, listing, fee_estimate_usdc: fee(price) });
    }
    const bidM = path.match(/^\/api\/auctions\/([^/]+)\/bids$/);
    if (m === "POST" && bidM) {
      const a = s.auctions.find((x) => x.id === bidM[1]);
      if (!a || a.status !== "open") return send(res, 404, { ok: false, error: "auction_not_found" });
      const amount = Number(b.amount_usdc);
      const min = (Number(a.highBidUsdc) || 0) + (Number(a.minIncrementUsdc) || 0.5);
      if (!(amount >= min) && !a.sealed) return send(res, 400, { ok: false, error: "invalid_bid", min_amount_usdc: min });
      if (a.sealed && !(amount > 0)) return send(res, 400, { ok: false, error: "invalid_bid" });
      if (!a.sealed) a.highBidUsdc = amount;
      else a.highBidUsdc = Math.max(Number(a.highBidUsdc) || 0, amount);
      a.highBidderId = s.me.id;
      const bd = { id: uid("bid"), auctionId: a.id, amountUsdc: amount, agentId: s.me.id, createdAt: new Date().toISOString() };
      s.bids.unshift(bd);
      return send(res, 200, { ok: true, bid: bd, auction: a, fee_if_won: fee(amount), message: `Bid ${amount} USDC accepted` });
    }
    const closeM = path.match(/^\/api\/auctions\/([^/]+)\/close$/);
    if (m === "POST" && closeM) {
      const a = s.auctions.find((x) => x.id === closeM[1]);
      if (!a) return send(res, 404, { ok: false, error: "auction_not_found" });
      closeAuction(s, a, b.force ? "forced" : "closed");
      return send(res, 200, { ok: true, auction: a, order: a._lastOrder || null });
    }
    const buyL = path.match(/^\/api\/listings\/([^/]+)\/purchase$/);
    if (m === "POST" && buyL) {
      const l = s.listings.find((x) => x.id === buyL[1] && x.status === "active");
      if (!l) return send(res, 404, { ok: false, error: "listing_not_found" });
      if (l.pricingMode !== "fixed") return send(res, 400, { ok: false, error: "not_fixed_price" });
      const f = fee(l.priceUsdc);
      const total = Math.round((l.priceUsdc + f) * 100) / 100;
      if (s.me.balanceUsdc < total) return send(res, 400, { ok: false, error: "insufficient_balance", need: total, balance_usdc: s.me.balanceUsdc });
      s.me.balanceUsdc = Math.round((s.me.balanceUsdc - total) * 100) / 100;
      l.status = "sold";
      const o = {
        id: uid("ord"),
        kind: "listing_purchase",
        listingId: l.id,
        title: l.title,
        amountUsdc: l.priceUsdc,
        feeUsdc: f,
        total_usdc: total,
        status: "paid",
        fulfillment: { kind: l.type === "physical" ? "external" : "platform", status: l.type === "physical" ? "pending_ship" : "delivered" },
        payment_request: paymentStub(l.priceUsdc, null),
        createdAt: new Date().toISOString(),
      };
      o.payment_request.order_id = o.id;
      s.orders.unshift(o);
      return send(res, 200, { ok: true, order: o, balance_usdc: s.me.balanceUsdc, me: meView(s) });
    }
    if (m === "GET" && path === "/api/skills") {
      return send(res, 200, {
        skills: s.skills.filter((x) => x.isPublic).map((x) => ({
          ...x,
          price_usdc: x.priceUsdc,
          owned: s.ownedSkillIds.includes(x.id),
          equipped: s.me.equippedSkills.includes(x.id),
        })),
        hidden_preserved_247: 247,
        ownedSkillIds: s.ownedSkillIds.slice(),
        equippedSkills: s.me.equippedSkills.slice(),
        owned_skill_ids: s.ownedSkillIds.slice(),
        equipped_skills: s.me.equippedSkills.slice(),
      });
    }
    const buyS = path.match(/^\/api\/skills\/([^/]+)\/purchase$/);
    if (m === "POST" && buyS) {
      const sk = s.skills.find((x) => x.id === buyS[1] && x.isPublic);
      if (!sk) return send(res, 404, { ok: false, error: "skill_not_found" });
      if (s.ownedSkillIds.includes(sk.id)) return send(res, 200, { ok: true, already_owned: true, balance_usdc: s.me.balanceUsdc, skill_id: sk.id, me: meView(s) });
      const f = fee(sk.priceUsdc);
      const total = Math.round((sk.priceUsdc + f) * 100) / 100;
      if (s.me.balanceUsdc < total) return send(res, 400, { ok: false, error: "insufficient_balance", need: total, balance_usdc: s.me.balanceUsdc });
      s.me.balanceUsdc = Math.round((s.me.balanceUsdc - total) * 100) / 100;
      s.ownedSkillIds.push(sk.id);
      const o = {
        id: uid("ord"),
        kind: "skill_purchase",
        skillId: sk.id,
        title: sk.name,
        amountUsdc: sk.priceUsdc,
        feeUsdc: f,
        total_usdc: total,
        status: "paid",
        fulfillment: { kind: "platform", status: "delivered" },
        payment_request: paymentStub(sk.priceUsdc, null),
        createdAt: new Date().toISOString(),
      };
      o.payment_request.order_id = o.id;
      s.orders.unshift(o);
      return send(res, 200, { ok: true, order: o, balance_usdc: s.me.balanceUsdc, owned_skill_ids: s.ownedSkillIds, me: meView(s) });
    }
    if (m === "POST" && path === "/api/agents/me/skills/equip") {
      const id = b.skill_id;
      if (!id) return send(res, 400, { ok: false, error: "skill_id_required" });
      if (!s.ownedSkillIds.includes(id)) return send(res, 400, { ok: false, error: "not_owned" });
      if (!s.me.equippedSkills.includes(id)) s.me.equippedSkills.push(id);
      return send(res, 200, { ok: true, equipped: s.me.equippedSkills, me: meView(s) });
    }
    if (m === "POST" && path === "/api/agents/me/skills/unequip") {
      const id = b.skill_id;
      if (!id) return send(res, 400, { ok: false, error: "skill_id_required" });
      s.me.equippedSkills = s.me.equippedSkills.filter((x) => x !== id);
      return send(res, 200, { ok: true, equipped: s.me.equippedSkills, me: meView(s) });
    }
    if (m === "GET" && path === "/api/orders") {
      return send(res, 200, {
        orders: s.orders.map((o) => ({
          ...o,
          amount_usdc: o.amountUsdc,
          platform_fee_usdc: o.feeUsdc,
          status: o.status || "paid",
        })),
        balance_usdc: s.me.balanceUsdc,
        me: meView(s),
        fee_rate: FEE,
      });
    }
    if (m === "GET" && path === "/api/payments/x402") {
      return send(res, 200, {
        ok: true,
        rail: { kind: "x402", chain: "base", asset: "USDC", status: "stub" },
        fee_rate_bps: 330,
        note: "x402 / USDC on Base is designed; demo wallet debit is the stub until wired.",
        endpoints: { quote: "POST /api/payments/x402/quote", confirm: "POST /api/payments/x402/confirm" },
        demo_behavior: "Purchases and auction wins debit the in-memory demo balance immediately and attach a payment_request stub on the order for agents to preview the future Base flow.",
        public_lvl_pay: "https://lvlltd.com/api/pay",
      });
    }
    if (m === "POST" && path === "/api/payments/x402/quote") {
      const amount = Number(b.amount_usdc || b.price_usdc || 0);
      if (!(amount > 0)) return send(res, 400, { ok: false, error: "amount_usdc_required" });
      return send(res, 200, { ok: true, payment_request: paymentStub(amount, b.order_id || null) });
    }
    if (m === "POST" && path === "/api/payments/x402/confirm") {
      return send(res, 200, {
        ok: true,
        status: "stub_confirmed",
        payment_request_id: b.payment_request_id || null,
        note: "Stub confirm — no chain settlement. Demo wallet already debited on purchase/win.",
      });
    }
    return send(res, 404, { ok: false, error: "not_found", path, hint: "GET /api/agent" });
  } catch (e) {
    return send(res, 500, { ok: false, error: "internal", message: String(e && e.message ? e.message : e) });
  }
};
