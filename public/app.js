const CDN = "https://cdn.jsdelivr.net/gh/omgawdmadeit1/lvlltd-agentic-marketplace@main/media";
const S = { p: "markets", me: null, auctions: [], listings: [], skills: [], orders: [], agent: null, loading: false, err: null };
const $ = (id) => document.getElementById(id);
const toast = (t) => { const e = $("toast"); e.textContent = t; e.classList.add("show"); setTimeout(() => e.classList.remove("show"), 2800); };
const money = (n) => (Number(n) || 0).toFixed(2) + " USDC";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&"+"amp;", "<":"&"+"lt;", ">":"&"+"gt;", '"':"&"+"quot;", "'":"&#39;" }[c]));

/* A — same-origin media with CDN fallback */
(function setupMedia() {
  const poster = $("poster");
  const video = $("bgv");
  const src = $("vidSrc");
  let fellBack = false;
  const toCdn = () => {
    if (fellBack) return;
    fellBack = true;
    poster.src = CDN + "/poster.jpg";
    video.setAttribute("poster", CDN + "/poster.jpg");
    src.src = CDN + "/welcome.mp4";
    video.load();
    video.play().catch(() => {});
  };
  poster.addEventListener("error", toCdn);
  video.addEventListener("error", toCdn);
  src.addEventListener("error", toCdn);
  video.muted = true;
  video.play().catch(() => {});
  video.addEventListener("playing", () => {
    poster.style.opacity = "0";
    poster.style.transition = "opacity .6s";
  });
  // If same-origin 404s quickly, fall back after load timeout
  setTimeout(() => {
    if (video.readyState < 2 && video.networkState === 3) toCdn();
  }, 2500);
})();

function add(role, text, acts = []) {
  const d = document.createElement("div");
  d.className = "msg " + role;
  d.appendChild(document.createTextNode(text));
  if (acts.length) {
    const a = document.createElement("div");
    a.className = "actions";
    acts.forEach((x) => {
      const b = document.createElement("button");
      b.textContent = x.l;
      b.onclick = () => go(x.i);
      a.appendChild(b);
    });
    d.appendChild(a);
  }
  $("msgs").appendChild(d);
  $("msgs").scrollTop = 1e9;
}

async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { "content-type": "application/json" } }, opts || {}));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.message || r.statusText || "request_failed");
  return j;
}

async function refresh() {
  S.loading = true;
  try {
    const [agent, auctions, listings, skills, orders] = await Promise.all([
      api("/api/agent"),
      api("/api/auctions"),
      api("/api/listings"),
      api("/api/skills"),
      api("/api/orders"),
    ]);
    S.agent = agent;
    S.auctions = auctions.auctions || [];
    S.listings = listings.listings || [];
    S.skills = skills.skills || [];
    S.orders = orders.orders || [];
    S.me = orders.me || null;
    S.err = null;
    $("bal").textContent = money(S.me ? (S.me.balance_usdc ?? S.me.balanceUsdc) : (orders.balance_usdc ?? 250));
    render();
  } catch (e) {
    S.err = e.message;
    $("bal").textContent = "offline";
    toast("API: " + e.message);
    render();
  } finally {
    S.loading = false;
  }
}

function titles() {
  return { markets: "Markets", skills: "Skills", sell: "Sell", orders: "Orders", agent: "Agent API" };
}

function render() {
  const t = S.p;
  $("pt").textContent = titles()[t] || t;
  $("psub").textContent = S.err ? "Error · retry" : "Live · /api";
  const pb = $("pb");
  if (S.err && !S.auctions.length) {
    pb.innerHTML = `<div class="card"><h3>Could not load</h3><p>${esc(S.err)}</p><div class="row"><button id="retry">Retry</button></div></div>`;
    const r = document.getElementById("retry"); if (r) r.onclick = () => refresh();
    return;
  }
  if (t === "markets") {
    const auc = S.auctions.map((a) => {
      const high = a.current_high_bid ?? a.highBidUsdc ?? 0;
      const min = high + (a.minIncrementUsdc || 0.5);
      return `<div class="card">
        <h3>${esc(a.title || a.listing?.title || a.id)}</h3>
        <p>${esc(a.description || a.listing?.description || "")}</p>
        <div class="row">
          <span class="badge">${esc(a.auction_type || a.kind || "english")} · high ${money(high)}</span>
          <button data-bid="${esc(a.id)}" data-min="${min}">Bid ≥ ${money(min)}</button>
        </div>
      </div>`;
    }).join("");
    const fixed = S.listings.filter((l) => (l.pricingMode || "").includes("fixed") || l.pricingMode === "bargain").map((l) =>
      `<div class="card"><h3>${esc(l.title)}</h3><p>${esc(l.description || "")} · ${esc(l.pricingMode)} · ${esc(l.type)}</p>
      <div class="row"><span class="badge">${money(l.priceUsdc)}</span><span class="tag">listing</span></div></div>`
    ).join("");
    pb.innerHTML = (auc || "<p class='muted'>No open auctions.</p>") + (fixed ? "<p class='muted' style='margin:14px 0 8px'>Fixed / bargain listings</p>" + fixed : "");
    pb.querySelectorAll("[data-bid]").forEach((b) => {
      b.onclick = async () => {
        const min = Number(b.dataset.min) || 0;
        const raw = prompt("Bid amount (USDC)", String(min));
        if (raw == null || raw === "") return;
        const amount = Number(raw);
        try {
          await api("/api/auctions/" + b.dataset.bid + "/bids", { method: "POST", body: JSON.stringify({ amount_usdc: amount }) });
          toast("Bid placed: " + money(amount));
          add("bot", "Bid locked at " + money(amount) + " on " + b.dataset.bid + ".");
          await refresh();
        } catch (e) { toast(e.message); }
      };
    });
  } else if (t === "skills") {
    pb.innerHTML = S.skills.map((s) => {
      const owned = !!s.owned;
      const equipped = !!s.equipped;
      const btn = owned
        ? (equipped ? `<button disabled>Equipped</button>` : `<button data-eq="${esc(s.id)}">Equip</button>`)
        : `<button data-buy="${esc(s.id)}">Buy ${money(s.price_usdc ?? s.priceUsdc)}</button>`;
      return `<div class="card"><h3>${esc(s.name)} ${owned ? '<span class="tag">owned</span>' : ""} ${equipped ? '<span class="tag">on</span>' : ""}</h3>
        <p>${esc(s.description || "")}</p>
        <div class="row"><span class="badge">${esc(s.category || "skill")} · ${money(s.price_usdc ?? s.priceUsdc)} + 3.3%</span>${btn}</div></div>`;
    }).join("") || "<p class='muted'>No public skills.</p>";
    pb.querySelectorAll("[data-buy]").forEach((b) => {
      b.onclick = async () => {
        try {
          const j = await api("/api/skills/" + b.dataset.buy + "/purchase", { method: "POST", body: "{}" });
          toast(j.already_owned ? "Already owned" : "Purchased (+3.3% fee)");
          add("bot", "Skill purchased. Equip it from Skills.");
          await refresh();
        } catch (e) { toast(e.message); }
      };
    });
    pb.querySelectorAll("[data-eq]").forEach((b) => {
      b.onclick = async () => {
        try {
          await api("/api/agents/me/skills/equip", { method: "POST", body: JSON.stringify({ skill_id: b.dataset.eq }) });
          toast("Skill equipped");
          add("bot", "Equipped " + b.dataset.eq + ".");
          await refresh();
        } catch (e) { toast(e.message); }
      };
    });
  } else if (t === "sell") {
    pb.innerHTML = `<div class="card">
      <h3>Create listing</h3>
      <p>Internal market · 3.3% platform fee on trades</p>
      <input class="fld" id="lt" placeholder="Title" style="margin-top:10px"/>
      <input class="fld" id="ld" placeholder="Description (optional)" style="margin-top:8px"/>
      <input class="fld" id="lp" placeholder="Price USDC" inputmode="decimal" style="margin-top:8px"/>
      <div class="row"><button id="cl">List item</button></div>
    </div>
    <p class="muted">Your recent listings</p>
    ${(S.listings.filter((l) => l.sellerId === (S.me && S.me.id)).map((l) =>
      `<div class="card"><h3>${esc(l.title)}</h3><p>${money(l.priceUsdc)} · ${esc(l.pricingMode)} · ${esc(l.status)}</p></div>`
    ).join("") || "<p class='muted'>No listings from you yet.</p>")}`;
    const cl = document.getElementById("cl");
    if (cl) cl.onclick = async () => {
      const title = document.getElementById("lt").value.trim();
      const description = document.getElementById("ld").value.trim();
      const price = Number(document.getElementById("lp").value);
      if (!title || !(price > 0)) { toast("Title and positive price required"); return; }
      try {
        await api("/api/listings", { method: "POST", body: JSON.stringify({ title, description: description || title, type: "digital", pricing_mode: "fixed", price_usdc: price }) });
        toast("Listed");
        add("bot", "Listed “" + title + "” at " + money(price) + ".");
        document.getElementById("lt").value = "";
        document.getElementById("ld").value = "";
        document.getElementById("lp").value = "";
        await refresh();
      } catch (e) { toast(e.message); }
    };
  } else if (t === "orders") {
    pb.innerHTML = (S.orders || []).map((o) =>
      `<div class="card"><h3>${esc(o.kind || "order")} · ${money(o.amount_usdc ?? o.amountUsdc)}</h3>
      <p>Fee ${money(o.platform_fee_usdc ?? o.feeUsdc)} · ${esc(o.status || "paid")} · ${esc((o.createdAt || "").slice(0, 19).replace("T", " "))}</p></div>`
    ).join("") || "<p class='muted'>No orders yet. Purchase a skill or create a listing.</p>";
  } else {
    const a = S.agent || {};
    pb.innerHTML = `<div class="card">
      <h3>Machine surface</h3>
      <p>Bot entry: <code>/api/agent</code></p>
      <p>Version ${esc(a.version || "—")} · fee ${(Number(a.fee_rate || 0.033) * 100).toFixed(1)}%</p>
      <p class="muted" style="margin-top:8px">Agents: GET /api/agent → /api/actions → bid or buy skills.</p>
      <div class="row">
        <button id="cpy">Copy agent URL</button>
        <button data-p2="markets">Open markets</button>
      </div>
    </div>
    <div class="card"><h3>Stats</h3>
      <p>Open auctions: ${esc(a.stats?.open_auctions ?? S.auctions.length)}</p>
      <p>Active listings: ${esc(a.stats?.active_listings ?? S.listings.length)}</p>
      <p>Public skills: ${esc(a.skills?.public_count ?? S.skills.length)}</p>
    </div>`;
    const c = document.getElementById("cpy");
    if (c) c.onclick = () => { navigator.clipboard.writeText(location.origin + "/api/agent"); toast("Copied /api/agent"); };
    pb.querySelectorAll("[data-p2]").forEach((b) => b.onclick = () => go(b.dataset.p2));
  }
}

function go(name) {
  S.p = name;
  $("panel").classList.add("open");
  document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("on", b.dataset.p === name));
  render();
}

$("m").onclick = () => $("panel").classList.toggle("open");
$("x").onclick = () => $("panel").classList.remove("open");
document.querySelectorAll(".nav button").forEach((b) => b.onclick = () => go(b.dataset.p));

function handleChat(v) {
  add("user", v);
  const l = v.toLowerCase();
  if (/skill|equip|power/.test(l)) {
    add("bot", "Skills are live from the catalog. Purchase deducts balance + 3.3% fee; equip after buy.", [{ l: "Browse skills", i: "skills" }]);
    go("skills");
  } else if (/sell|list|inventory/.test(l)) {
    add("bot", "Create a listing on the internal market. Fee 3.3% on settlement.", [{ l: "Sell", i: "sell" }]);
    go("sell");
  } else if (/order|history|balance/.test(l)) {
    add("bot", "Orders and balance come from the live API.", [{ l: "Orders", i: "orders" }]);
    go("orders");
  } else if (/agent|api|bot|machine/.test(l)) {
    add("bot", "Agents start at GET /api/agent — self-describing actions, auctions, skills.", [{ l: "Agent API", i: "agent" }]);
    go("agent");
  } else if (/bid|auction|market|shop|buy/.test(l)) {
    add("bot", "Open auctions and listings from the market engine.", [{ l: "Markets", i: "markets" }]);
    go("markets");
  } else {
    add("bot", "I can open live markets, skills, sell, or orders — all wired to /api/*.", [
      { l: "Markets", i: "markets" }, { l: "Skills", i: "skills" }, { l: "Sell", i: "sell" }
    ]);
    go("markets");
  }
}

$("send").onclick = () => {
  const v = $("in").value.trim();
  if (!v) return;
  $("in").value = "";
  handleChat(v);
};
$("in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("send").click(); });

add("bot", "Welcome to LVL — humans converse, agents act. Markets and skills load from the live API.", [
  { l: "Markets", i: "markets" }, { l: "Skills", i: "skills" }, { l: "Sell", i: "sell" }
]);
refresh();
go("markets");
