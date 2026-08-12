const PLATFORM_FEE_RATE = 0.033;
const uid = (p = "id") =>
  p + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const feeOf = (n) => Math.round(n * PLATFORM_FEE_RATE * 1e6) / 1e6;

const PUBLIC_SKILLS = [
  { id: "skill_price_watcher", name: "Price Watcher", priceUsdc: 4.5, isPublic: true, description: "Alerts on auction price moves", category: "market" },
  { id: "skill_sniper", name: "Bid Sniper", priceUsdc: 9.0, isPublic: true, description: "Last-second bid assist", category: "auction" },
  { id: "skill_bargain_coach", name: "Bargain Coach", priceUsdc: 6.5, isPublic: true, description: "Offer strategy hints", category: "bargain" },
  { id: "skill_catalog_radar", name: "Catalog Radar", priceUsdc: 3.0, isPublic: true, description: "Surfaces new listings fast", category: "discovery" },
  { id: "skill_risk_guard", name: "Risk Guard", priceUsdc: 5.5, isPublic: true, description: "Caps overbid exposure", category: "risk" },
];

const DEMO_AGENT = {
  id: "agent_demo_you",
  name: "Your Grok Bot",
  balanceUsdc: 250,
  equippedSkills: [],
  skillConfigs: {},
};

function seedListings() {
  const listings = [
    { id: "lst_dataset_alpha", title: "Alpha Dataset Pack", description: "Curated agent training traces", type: "digital", pricingMode: "english_auction", priceUsdc: 10, status: "active", sellerId: "seller_a", createdAt: new Date().toISOString() },
    { id: "lst_prompt_kit", title: "Prompt Kit Pro", description: "Battle-tested prompt library", type: "digital", pricingMode: "fixed", priceUsdc: 18, status: "active", sellerId: "seller_b", createdAt: new Date().toISOString() },
    { id: "lst_sensor_node", title: "Sensor Node (physical)", description: "Ships externally", type: "physical", pricingMode: "fixed", priceUsdc: 42, status: "active", sellerId: "seller_c", createdAt: new Date().toISOString() },
    { id: "lst_barter_slot", title: "Compute Barter Slot", description: "Trade GPU hours", type: "digital", pricingMode: "bargain", priceUsdc: 15, status: "active", sellerId: "seller_a", createdAt: new Date().toISOString() },
    { id: "lst_vickrey_lot", title: "Silent Lot — Model Weights", description: "Vickrey sealed bid", type: "digital", pricingMode: "vickrey_auction", priceUsdc: 25, status: "active", sellerId: "seller_b", createdAt: new Date().toISOString() },
  ];
  const auctions = [
    { id: "auc_dataset_alpha", listingId: "lst_dataset_alpha", status: "open", highBidUsdc: 11.5, minIncrementUsdc: 0.5, endsAt: new Date(Date.now() + 864e5).toISOString() },
    { id: "auc_vickrey_lot", listingId: "lst_vickrey_lot", status: "open", highBidUsdc: 0, minIncrementUsdc: 1, endsAt: new Date(Date.now() + 1728e5).toISOString(), kind: "vickrey" },
  ];
  return { listings, auctions, bids: [] };
}

const g = globalThis;
function state() {
  if (!g.__lvlMarketEngine) {
    const seed = seedListings();
    g.__lvlMarketEngine = {
      me: { ...DEMO_AGENT },
      skills: [
        ...PUBLIC_SKILLS,
        ...Array.from({ length: 247 }, (_, i) => ({
          id: "skill_legacy_" + i,
          name: "Legacy " + i,
          priceUsdc: 1,
          isPublic: false,
          isPreserved247: true,
        })),
      ],
      listings: seed.listings,
      auctions: seed.auctions,
      bids: seed.bids,
      bargains: [],
      offers: [],
      orders: [],
      events: [],
      ownedSkillIds: [],
    };
  }
  return g.__lvlMarketEngine;
}

function publicSkills() {
  return state().skills.filter((s) => s.isPublic);
}
function openAuctions() {
  const s = state();
  return s.auctions
    .filter((a) => a.status === "open")
    .map((a) => {
      const listing = s.listings.find((l) => l.id === a.listingId);
      return listing ? { ...a, listing } : null;
    })
    .filter(Boolean);
}

const ACTIONS = [
  { name: "get_marketplace_description", method: "GET", path: "/api/agent" },
  { name: "get_action_catalog", method: "GET", path: "/api/actions" },
  { name: "list_open_auctions", method: "GET", path: "/api/auctions?status=open" },
  { name: "create_listing", method: "POST", path: "/api/listings", body: { title: "string", price_usdc: "number" } },
  { name: "place_bid", method: "POST", path: "/api/auctions/{id}/bids", body: { amount_usdc: "number" } },
  { name: "start_bargain", method: "POST", path: "/api/bargains", body: { listing_id: "string" } },
  { name: "submit_offer", method: "POST", path: "/api/bargains/{id}/offers", body: { amount_usdc: "number" } },
  { name: "get_skill_catalog", method: "GET", path: "/api/skills" },
  { name: "purchase_skill", method: "POST", path: "/api/skills/{id}/purchase" },
  { name: "equip_skill", method: "POST", path: "/api/agents/me/skills/equip", body: { skill_id: "string" } },
  { name: "get_my_orders", method: "GET", path: "/api/orders" },
];

function send(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization, x-agent-id, x-payment");
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
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

    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `https://${host}`);
    let path = url.pathname;
    // When routed via /api/index, Vercel may pass stripped path — normalize
    if (path === "/api/index" || path === "/api/index.js") path = "/";
    if (!path.startsWith("/api") && path !== "/") {
      path = "/api" + (path.startsWith("/") ? path : "/" + path);
    }
    // If path is just / and original had /api/...
    const original = req.url || "";
    if (path === "/" && original.includes("/api/")) {
      path = original.split("?")[0];
    }

    const m = (req.method || "GET").toUpperCase();
    const body = m === "POST" || m === "PUT" || m === "PATCH" ? await readBody(req) : {};
    const s = state();

    if (m === "GET" && (path === "/api/agent" || path === "/api")) {
      return send(res, 200, {
        name: "LVL — Agentic Marketplace",
        domain: "agentic.lvlltd.com",
        version: "1.0.0-sprint1",
        fee_rate: PLATFORM_FEE_RATE,
        fee_note: "3.3% platform fee on internal trades and skill purchases",
        surfaces: {
          human: "Conversation-first progressive UI",
          agent: "Self-describing machine interface (OpenAPI + action schemas + MCP-ready)",
        },
        market_mechanisms: [
          "english_auction",
          "vickrey_auction",
          "fixed_price",
          "bargain",
          "trade_barter",
          "price_matching",
        ],
        fulfillment: { digital: "platform", physical: "external" },
        skills: {
          role: "Real-time power-ups inside the marketplace",
          public_count: publicSkills().length,
          preserved_247_hidden: 247,
        },
        stats: {
          open_auctions: openAuctions().length,
          active_listings: s.listings.filter((l) => l.status === "active").length,
          events: s.events.length,
        },
        next_actions: ACTIONS.map((a) => a.name),
        first_contact: {
          step_1: "GET /api/agent — read rules and fee structure",
          step_2: "GET /api/actions — load parameter schemas",
          step_3: "POST /api/auctions/{id}/bids | GET /api/skills | POST /api/skills/{id}/purchase",
        },
        bot_base_url_hint:
          "Call absolute URLs against this deployment origin. CORS is open for agent clients.",
        ok: true,
        bot_entry: "/api/agent",
      });
    }
    if (m === "GET" && path === "/api/actions") return send(res, 200, { actions: ACTIONS, fee_rate: PLATFORM_FEE_RATE });
    if (m === "GET" && path === "/api/openapi.json") {
      return send(res, 200, {
        openapi: "3.1.0",
        info: { title: "LVL Agentic Marketplace", version: "1.0.0-sprint1" },
        paths: Object.fromEntries(
          ACTIONS.map((a) => [a.path.split("?")[0], { [a.method.toLowerCase()]: { summary: a.name } }]),
        ),
      });
    }
    if (m === "GET" && path === "/api/auctions") {
      const status = url.searchParams.get("status") || "open";
      const list = openAuctions().filter((a) => status === "all" || a.status === status);
      return send(res, 200, {
        auctions: list.map((a) => ({
          id: a.id,
          listing_id: a.listingId,
          title: a.listing.title,
          description: a.listing.description,
          type: a.listing.type,
          auction_type: a.kind === "vickrey" ? "vickrey" : "english",
          reserve_price: a.listing.priceUsdc,
          current_high_bid: a.highBidUsdc,
          status: a.status,
          end_at: a.endsAt,
        })),
      });
    }
    if (m === "GET" && path === "/api/listings") return send(res, 200, { listings: s.listings.filter((l) => l.status === "active") });
    if (m === "POST" && path === "/api/listings") {
      const listing = {
        id: uid("lst"),
        title: String(body.title || "Untitled"),
        description: String(body.description || ""),
        type: body.type === "physical" ? "physical" : "digital",
        pricingMode: body.pricing_mode || "fixed",
        priceUsdc: Number(body.price_usdc || 0),
        status: "active",
        sellerId: s.me.id,
        createdAt: new Date().toISOString(),
      };
      s.listings.unshift(listing);
      s.events.unshift({
        id: uid("evt"),
        type: "listing_created",
        payload: { listing_id: listing.id },
        createdAt: new Date().toISOString(),
      });
      return send(res, 200, { ok: true, listing });
    }
    const bidMatch = path.match(/^\/api\/auctions\/([^/]+)\/bids$/);
    if (m === "POST" && bidMatch) {
      const auction = s.auctions.find((a) => a.id === bidMatch[1]);
      if (!auction) return send(res, 404, { ok: false, error: "auction_not_found" });
      const amount = Number(body.amount_usdc);
      if (!Number.isFinite(amount)) return send(res, 400, { ok: false, error: "invalid_amount" });
      const min = (auction.highBidUsdc || 0) + (auction.minIncrementUsdc || 0.5);
      if (amount < min) return send(res, 400, { ok: false, error: "bid_too_low", min });
      if (s.me.balanceUsdc < amount) return send(res, 400, { ok: false, error: "insufficient_balance" });
      auction.highBidUsdc = amount;
      const bid = {
        id: uid("bid"),
        auctionId: auction.id,
        agentId: s.me.id,
        amountUsdc: amount,
        createdAt: new Date().toISOString(),
      };
      s.bids.unshift(bid);
      s.events.unshift({
        id: uid("evt"),
        type: "bid_placed",
        payload: { auction_id: auction.id, amount_usdc: amount },
        createdAt: new Date().toISOString(),
      });
      return send(res, 200, { ok: true, bid, auction, fee_if_won: feeOf(amount) });
    }
    if (m === "POST" && path === "/api/bargains") {
      const listing = s.listings.find((l) => l.id === body.listing_id);
      if (!listing) return send(res, 404, { ok: false, error: "listing_not_found" });
      const bargain = {
        id: uid("brg"),
        listingId: listing.id,
        status: "open",
        createdAt: new Date().toISOString(),
      };
      s.bargains.unshift(bargain);
      return send(res, 200, { ok: true, bargain });
    }
    const offerMatch = path.match(/^\/api\/bargains\/([^/]+)\/offers$/);
    if (m === "POST" && offerMatch) {
      const bargain = s.bargains.find((b) => b.id === offerMatch[1]);
      if (!bargain) return send(res, 404, { ok: false, error: "bargain_not_found" });
      const amount = Number(body.amount_usdc);
      if (!Number.isFinite(amount)) return send(res, 400, { ok: false, error: "invalid_amount" });
      const offer = {
        id: uid("off"),
        bargainId: bargain.id,
        amountUsdc: amount,
        agentId: s.me.id,
        createdAt: new Date().toISOString(),
      };
      s.offers.unshift(offer);
      return send(res, 200, { ok: true, offer, fee: feeOf(amount) });
    }
    if (m === "GET" && path === "/api/skills") return send(res, 200, { skills: publicSkills().map(s=>({...s, price_usdc:s.priceUsdc})), hidden_preserved_247: 247 });
    const purchaseMatch = path.match(/^\/api\/skills\/([^/]+)\/purchase$/);
    if (m === "POST" && purchaseMatch) {
      const skill = s.skills.find((x) => x.id === purchaseMatch[1] && x.isPublic);
      if (!skill) return send(res, 404, { ok: false, error: "skill_not_found" });
      const fee = feeOf(skill.priceUsdc);
      const total = skill.priceUsdc + fee;
      if (s.me.balanceUsdc < total) return send(res, 400, { ok: false, error: "insufficient_balance", need: total });
      s.me.balanceUsdc = Math.round((s.me.balanceUsdc - total) * 100) / 100;
      if (!s.ownedSkillIds.includes(skill.id)) s.ownedSkillIds.push(skill.id);
      const order = {
        id: uid("ord"),
        kind: "skill_purchase",
        skillId: skill.id,
        amountUsdc: skill.priceUsdc,
        feeUsdc: fee,
        createdAt: new Date().toISOString(),
      };
      s.orders.unshift(order);
      return send(res, 200, { ok: true, order, balance_usdc: s.me.balanceUsdc });
    }
    if (m === "POST" && path === "/api/agents/me/skills/equip") {
      const skillId = body.skill_id;
      if (!s.ownedSkillIds.includes(skillId)) return send(res, 400, { ok: false, error: "not_owned" });
      if (!s.me.equippedSkills.includes(skillId)) s.me.equippedSkills.push(skillId);
      return send(res, 200, { ok: true, equipped: s.me.equippedSkills });
    }
    if (m === "GET" && path === "/api/orders") return send(res, 200, { orders: s.orders.map(o=>({...o, amount_usdc:o.amountUsdc, platform_fee_usdc:o.feeUsdc, status:o.status||"paid"})), balance_usdc: s.me.balanceUsdc, me: { ...s.me, balance_usdc: s.me.balanceUsdc, balanceUsdc: s.me.balanceUsdc } });
    if (m === "GET" && path === "/api/me") return send(res, 200, { agent: s.me, owned_skills: s.ownedSkillIds });
    if (m === "GET" && path === "/api/events") return send(res, 200, { events: s.events.slice(0, 40) });
    if (m === "GET" && path === "/api/health") {
      return send(res, 200, {
        ok: true,
        service: "LVL Agentic Marketplace",
        version: "1.0.0-sprint1",
        bot_entry: "/api/agent",
      });
    }
    return send(res, 404, { ok: false, error: "not_found", path, hint: "GET /api/agent" });
  } catch (err) {
    return send(res, 500, { ok: false, error: "internal", message: String(err && err.message ? err.message : err) });
  }
}
