

const CDN_POSTER="https://cdn.jsdelivr.net/gh/omgawdmadeit1/lvlltd-agentic-marketplace@main/media/poster.jpg";
const CDN_VIDEO="https://cdn.jsdelivr.net/gh/omgawdmadeit1/lvlltd-agentic-marketplace@main/media/welcome.mp4";
const FEE=0.033;
const LVL_PUBLIC={about:"https://lvlltd.com/about.json",a2a:"https://lvlltd.com/api/a2a",mcp:"https://lvlltd.com/api/mcp",pay:"https://lvlltd.com/api/pay",proof:"https://lvlltd.com/api/proof",card:"https://lvlltd.com/.well-known/agent-card.json"};
const PROMPTS={
tight:`# LVL Orchestrator v2 · TIGHT
You are LVL Orchestrator — plan, route, verify. Never invent GMV, unlocks, prices, or proof.
Operator: LVL LTD CO · https://lvlltd.com/about.json
Stack: A2A https://lvlltd.com/api/a2a · MCP https://lvlltd.com/api/mcp · x402 /api/pay X-PAYMENT · AP2 X-AP2-MANDATE · Proof /api/proof
A2A/MCP never settle. Specialists: scout|evaluator|trader|settler|installer|scribe|risk
Buy: intent→scout→eval→quote→mandate?→human gate→x402→proof→install
Agentic: GET /api/agent→/api/actions; fee 3.3%; equip only owned.
Output: Plan | Actions | Status | Evidence | Budget | Next + JSON lvl-orchestrator-v2
Boot: LVL Orchestrator online. Goal?`,
json:`# LVL Orchestrator v2 · JSON-ONLY
Reply with ONE JSON object only. Never invent GMV/unlocks/prices/tx/proof.
Protocols: a2a https://lvlltd.com/api/a2a | mcp https://lvlltd.com/api/mcp | x402 https://lvlltd.com/api/pay | agentic GET /api/agent fee 0.033
Always: {"orchestrator":"lvl-orchestrator-v2","goal":"","status":"needs_human","selected_skill_id":null,"quote_usdc":null,"tx_hash":null,"proof_ok":false,"specialists_used":[],"risks":[],"next_action":"","human_gate":null}`,
full:`# ROLE
You are LVL Orchestrator — plan, route, verify. Never invent GMV/unlocks/prices.
Identity: LVL LTD CO · https://lvlltd.com/about.json
# STACK A2A | MCP | x402 /api/pay | AP2 | Proof — A2A/MCP never settle
# SPECIALISTS scout evaluator trader settler installer scribe risk
# BUY intent→scout→eval→quote→human gate→x402→proof→install
# AGENTIC GET /api/agent; fee 3.3%; equip only owned
# OUTPUT Plan|Actions|Status|Evidence|Budget|Next + machine JSON
# BOOT LVL Orchestrator online. Give a goal.`
};

const S={p:"markets", balance:null, owned:new Set(), equipped:new Set(), lastOrch:null};
const $=id=>document.getElementById(id);
const esc=s=>{const m={"&":"&"+"amp;","<":"&"+"lt;",">":"&"+"gt;","\"":"&"+"quot;","'":"&#"+"39;"};return String(s??"").replace(/[&<>"']/g,c=>m[c]);};
const money=n=>Number(n||0).toFixed(2);
const feeOf=n=>Math.round(Number(n)*FEE*1e6)/1e6;
const toast=t=>{const e=$("toast");e.textContent=t;e.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>e.classList.remove("show"),2800)};
function setBal(n){if(n==null||!Number.isFinite(Number(n)))return;S.balance=Number(n);$("bal").textContent=money(S.balance)+" USDC"}
function applyMe(me){
  if(!me)return;
  setBal(me.balance_usdc??me.balanceUsdc);
  S.owned=new Set(me.ownedSkillIds||[]);
  S.equipped=new Set(me.equippedSkills||[]);
}
async function api(path,opts){
  const r=await fetch(path,{headers:{"content-type":"application/json",...(opts&&opts.headers||{})},...opts});
  let j=null; try{j=await r.json()}catch{j={ok:false,error:"bad_json"}}
  if(!r.ok){const err=new Error((j&& (j.error||j.message))||("HTTP "+r.status)); err.payload=j; err.status=r.status; throw err}
  if(j&&j.me) applyMe(j.me);
  if(j&&j.balance_usdc!=null) setBal(j.balance_usdc);
  return j;
}
function add(role,text,acts=[]){
  const d=document.createElement("div"); d.className="msg "+role; d.appendChild(document.createTextNode(text));
  if(acts.length){const a=document.createElement("div"); a.className="actions";
    acts.forEach(x=>{const b=document.createElement("button"); b.type="button"; b.textContent=x.l; b.onclick=()=>x.fn?x.fn():go(x.i); a.appendChild(b)});
    d.appendChild(a)}
  $("msgs").appendChild(d); $("msgs").scrollTop=$("msgs").scrollHeight;
}
function fmtEta(sec){
  if(sec==null) return "";
  if(sec<=0) return "ended";
  const m=Math.floor(sec/60), s=sec%60;
  if(m>=60) return Math.floor(m/60)+"h "+(m%60)+"m";
  return m+"m "+s+"s";
}
async function refreshMe(){
  try{ const j=await api("/api/me"); applyMe(j.me); return j.me; }catch(e){ console.warn(e); }
}
async function go(n){
  S.p=n; $("panel").classList.add("open"); $("panel").setAttribute("aria-hidden","false");
  const scr=$("scrim"); if(scr) scr.classList.add("on");
  document.querySelectorAll(".nav button").forEach(b=>b.classList.toggle("on",b.dataset.p===n));
  $("pt").textContent={markets:"Markets",skills:"Skills",sell:"Sell",orders:"Orders",agent:"Agent + Orch"}[n];
  $("psub").textContent=n==="agent"?"Orchestrator v2 · dual surface":"Live API · fee 3.3%";
  const pb=$("pb"); pb.innerHTML='<p class="muted">Loading…</p>';
  try{
    if(n==="markets") await renderMarkets(pb);
    else if(n==="skills") await renderSkills(pb);
    else if(n==="sell") renderSell(pb);
    else if(n==="orders") await renderOrders(pb);
    else await renderAgent(pb);
  }catch(e){ pb.innerHTML=`<p class="err">${esc(e.message||e)}</p>` }
}
async function renderMarkets(pb){
  await refreshMe();
  const [auctionsRes, listingsRes]=await Promise.all([api("/api/auctions"), api("/api/listings")]);
  const auctions=auctionsRes.auctions||[];
  const open=auctions.filter(a=>a.status==="open");
  const closed=auctions.filter(a=>a.status!=="open");
  const listings=listingsRes.listings||[];
  const auctionListingIds=new Set(auctions.map(a=>a.listingId||a.listing?.id));
  let html=`<p class="muted">Balance <span class="ok">${money(S.balance)}</span> USDC. Flash Lot auto-closes ~3 min after cold start for lifecycle demos.</p>`;
  html+=`<p class="muted" style="margin-top:10px">Open auctions (${open.length})</p>`;
  if(!open.length) html+=`<div class="card"><p>No open auctions.</p></div>`;
  for(const a of open){
    const title=a.title||a.listing?.title||a.id;
    const kind=a.auction_type||a.kind||"english";
    const sealed=!!a.sealed;
    const high=sealed? "sealed" : money(a.current_high_bid??a.highBidUsdc??0);
    const minInc=a.minIncrementUsdc??0.5;
    const next=sealed? (a.reserveUsdc||a.listing?.priceUsdc||1) : Number(a.current_high_bid??a.highBidUsdc??0)+Number(minInc);
    const desc=a.description||a.listing?.description||"";
    const eta=fmtEta(a.seconds_remaining);
    html+=`<div class="card">
      <h3>${esc(title)} ${a.closing_soon?'<span class="pill warn">closing soon</span>':''}</h3>
      <p>${esc(kind)}${sealed?' · sealed':''} · ${esc(desc)}</p>
      <div class="row"><span class="badge">${sealed?'Bids sealed':('High '+high+' USDC')}</span><span class="muted">${esc(eta)}</span></div>
      <div class="field"><label>Bid amount (USDC)</label><input type="number" step="0.01" value="${money(next)}" data-bid-input="${esc(a.id)}"/></div>
      <div class="row"><span class="muted">Fee if you win ~${money(feeOf(next))}</span>
        <button type="button" class="primary" data-bid="${esc(a.id)}">Place bid</button>
        <button type="button" data-close="${esc(a.id)}">Close now</button>
      </div>
    </div>`;
  }
  html+=`<p class="muted" style="margin-top:14px">Buy now (fixed)</p>`;
  const fixed=listings.filter(l=>l.status==="active"&&l.pricingMode==="fixed");
  if(!fixed.length) html+=`<div class="card"><p>No fixed listings.</p></div>`;
  for(const l of fixed){
    const total=Number(l.priceUsdc)+feeOf(l.priceUsdc);
    html+=`<div class="card">
      <h3>${esc(l.title)}</h3>
      <p>${esc(l.type)} · ${esc(l.description||"")}</p>
      <div class="row"><span class="badge">${money(l.priceUsdc)} + ${money(feeOf(l.priceUsdc))} fee</span><span class="muted">total ${money(total)}</span></div>
      <div class="row"><button type="button" class="primary" data-buy-listing="${esc(l.id)}">Buy</button></div>
    </div>`;
  }
  const other=listings.filter(l=>l.status==="active"&&!auctionListingIds.has(l.id)&&l.pricingMode!=="fixed");
  if(other.length){
    html+=`<p class="muted" style="margin-top:14px">Other active</p>`;
    for(const l of other){
      html+=`<div class="card"><h3>${esc(l.title)}</h3><p>${esc(l.pricingMode)} · ${money(l.priceUsdc)} USDC</p></div>`;
    }
  }
  if(closed.length){
    html+=`<p class="muted" style="margin-top:14px">Closed / cleared</p>`;
    for(const a of closed.slice(0,8)){
      html+=`<div class="card"><h3>${esc(a.title||a.id)}</h3>
        <p>${esc(a.status)}${a.closeReason?(' · '+esc(a.closeReason)):''}${a.clearPriceUsdc!=null?(' · clear '+money(a.clearPriceUsdc)):''}</p>
        <p class="muted">${a.winnerId?('winner '+esc(a.winnerId)): 'no winner'}</p></div>`;
    }
  }
  pb.innerHTML=html;
  pb.querySelectorAll("[data-bid]").forEach(btn=>{
    btn.onclick=async()=>{
      const id=btn.getAttribute("data-bid");
      const input=pb.querySelector(`[data-bid-input="${CSS.escape(id)}"]`);
      const amount=Number(input&&input.value);
      btn.disabled=true;
      try{
        const j=await api(`/api/auctions/${encodeURIComponent(id)}/bids`,{method:"POST",body:JSON.stringify({amount_usdc:amount})});
        toast(j.message||(`Bid ${money(j.bid?.amountUsdc??amount)} · fee if won ${money(j.fee_if_won??feeOf(amount))}`));
        add("bot", j.message||`Bid placed on ${id}.`);
        await go("markets");
      }catch(e){ toast(e.payload?.error||e.message); btn.disabled=false }
    };
  });
  pb.querySelectorAll("[data-close]").forEach(btn=>{
    btn.onclick=async()=>{
      btn.disabled=true;
      try{
        const j=await api(`/api/auctions/${encodeURIComponent(btn.dataset.close)}/close`,{method:"POST",body:JSON.stringify({force:true})});
        const a=j.auction||{};
        toast(a.status==="cleared"?`Cleared @ ${money(a.clearPriceUsdc)}`:`Closed: ${a.status}${a.closeReason?(' '+a.closeReason):''}`);
        if(j.order) add("bot",`You won — order ${j.order.id}. Fee ${money(j.order.feeUsdc)} USDC.`);
        await go(j.order?"orders":"markets");
      }catch(e){ toast(e.payload?.error||e.message); btn.disabled=false }
    };
  });
  pb.querySelectorAll("[data-buy-listing]").forEach(btn=>{
    btn.onclick=async()=>{
      btn.disabled=true;
      try{
        const j=await api(`/api/listings/${encodeURIComponent(btn.dataset.buyListing)}/purchase`,{method:"POST",body:"{}"});
        toast(`Purchased · total ${money(j.order?.total_usdc)} · bal ${money(j.balance_usdc)}`);
        add("bot",`Bought ${j.order?.title||"listing"}. Fee ${money(j.order?.feeUsdc)} (3.3%).`);
        await go("orders");
      }catch(e){ toast(e.payload?.error||e.message); btn.disabled=false }
    };
  });
}
async function renderSkills(pb){
  await refreshMe();
  const skillsRes=await api("/api/skills");
  const skills=skillsRes.skills||[];
  (skillsRes.ownedSkillIds||[]).forEach(id=>S.owned.add(id));
  (skillsRes.equippedSkills||[]).forEach(id=>S.equipped.add(id));
  let html=`<p class="muted">Owned ${S.owned.size} · equipped ${S.equipped.size}. Legacy 247 hidden.</p>`;
  for(const sk of skills){
    const price=sk.price_usdc??sk.priceUsdc??0;
    const isOwned=S.owned.has(sk.id);
    const isEq=S.equipped.has(sk.id);
    html+=`<div class="card">
      <h3>${esc(sk.name)}</h3>
      <p>${esc(sk.description||"")} · ${esc(sk.category||"")}</p>
      <div class="row"><span class="badge">${money(price)} + ${money(feeOf(price))} fee</span>
        <span class="muted">${isEq?"Equipped":isOwned?"Owned":"Total "+money(price+feeOf(price))}</span></div>
      <div class="row">
        <button type="button" class="primary" data-buy="${esc(sk.id)}" ${isOwned?"disabled":""}>${isOwned?"Purchased":"Buy"}</button>
        <button type="button" data-equip="${esc(sk.id)}" ${!isOwned||isEq?"disabled":""}>Equip</button>
        <button type="button" data-unequip="${esc(sk.id)}" ${!isEq?"disabled":""}>Unequip</button>
      </div>
    </div>`;
  }
  pb.innerHTML=html;
  pb.querySelectorAll("[data-buy]").forEach(btn=>{
    btn.onclick=async()=>{
      btn.disabled=true;
      try{
        const j=await api(`/api/skills/${encodeURIComponent(btn.dataset.buy)}/purchase`,{method:"POST",body:"{}"});
        if(j.already_owned) toast("Already owned");
        else toast(`Purchased · fee ${money(j.order?.feeUsdc||0)}`);
        await go("skills");
      }catch(e){ toast(e.payload?.error||e.message); btn.disabled=false }
    };
  });
  pb.querySelectorAll("[data-equip]").forEach(btn=>{
    btn.onclick=async()=>{
      try{ await api("/api/agents/me/skills/equip",{method:"POST",body:JSON.stringify({skill_id:btn.dataset.equip})}); toast("Equipped"); await go("skills"); }
      catch(e){ toast(e.payload?.error||e.message) }
    };
  });
  pb.querySelectorAll("[data-unequip]").forEach(btn=>{
    btn.onclick=async()=>{
      try{ await api("/api/agents/me/skills/unequip",{method:"POST",body:JSON.stringify({skill_id:btn.dataset.unequip})}); toast("Unequipped"); await go("skills"); }
      catch(e){ toast(e.payload?.error||e.message) }
    };
  });
}
function renderSell(pb){
  pb.innerHTML=`<p class="muted">POST /api/listings — auctions auto-open when mode is english/vickrey.</p>
  <div class="card">
    <div class="field"><label>Title</label><input id="sell-title" placeholder="Prompt Pack"/></div>
    <div class="field"><label>Price / reserve (USDC)</label><input id="sell-price" type="number" step="0.01" min="0.01" value="12"/></div>
    <div class="field"><label>Description</label><textarea id="sell-desc"></textarea></div>
    <div class="field"><label>Type</label><select id="sell-type"><option value="digital">digital</option><option value="physical">physical</option></select></div>
    <div class="field"><label>Pricing mode</label><select id="sell-mode"><option value="fixed">fixed</option><option value="bargain">bargain</option><option value="english_auction">english_auction</option><option value="vickrey_auction">vickrey_auction</option></select></div>
    <div class="row"><span class="muted">Est. fee ${money(feeOf(12))}</span><button type="button" class="primary" id="sell-go">Publish</button></div>
    <p class="err" id="sell-err" hidden></p>
  </div>`;
  $("sell-go").onclick=async()=>{
    const err=$("sell-err"); err.hidden=true;
    const body={title:$("sell-title").value.trim(), price_usdc:Number($("sell-price").value), description:$("sell-desc").value.trim(), type:$("sell-type").value, pricing_mode:$("sell-mode").value};
    try{
      const j=await api("/api/listings",{method:"POST",body:JSON.stringify(body)});
      toast("Created "+(j.listing?.id||""));
      add("bot",`Listed “${body.title}”.`);
      go("markets");
    }catch(e){ err.hidden=false; err.textContent=e.payload?.error||e.message }
  };
}
async function renderOrders(pb){
  const o=await api("/api/orders");
  applyMe(o.me);
  const orders=o.orders||[];
  let html=`<div class="card"><h3>Balance</h3>
    <div class="row"><span class="badge" style="font-size:16px">${money(S.balance)} USDC</span><span class="muted">fee rate ${(FEE*100).toFixed(1)}%</span></div>
    <p class="muted" style="margin-top:6px">Demo wallet persists for the warm serverless instance.</p></div>`;
  html+=`<p class="muted">Order history (${orders.length})</p>`;
  if(!orders.length) html+=`<div class="card"><p>No orders yet. Buy a fixed listing, win an auction, or purchase a skill.</p></div>`;
  for(const ord of orders){
    const fulfill=ord.fulfillment||{};
    html+=`<div class="card">
      <h3>${esc(ord.title||ord.kind||"order")}</h3>
      <p>${esc(ord.kind)} · ${esc(ord.id)}</p>
      <div class="row"><span class="badge">${money(ord.amount_usdc??ord.amountUsdc)} + fee ${money(ord.platform_fee_usdc??ord.feeUsdc)}</span>
        <span class="muted">total ${money(ord.total_usdc)}</span></div>
      <div class="row"><span class="pill">${esc(ord.status||"paid")}</span>
        <span class="muted">${esc(fulfill.kind||"")} · ${esc(fulfill.status||"")}</span></div>
      <p class="muted">${esc(ord.createdAt||"")}</p>
    </div>`;
  }
  html+=`<p class="muted" style="margin-top:12px">Equipped skills</p>`;
  const eq=[...S.equipped];
  html+= eq.length? eq.map(id=>`<div class="card"><h3>${esc(id)}</h3><button type="button" data-unequip="${esc(id)}">Unequip</button></div>`).join("") : `<div class="card"><p>None equipped.</p></div>`;
  pb.innerHTML=html;
  pb.querySelectorAll("[data-unequip]").forEach(btn=>{
    btn.onclick=async()=>{
      try{ await api("/api/agents/me/skills/unequip",{method:"POST",body:JSON.stringify({skill_id:btn.dataset.unequip})}); await go("orders"); }
      catch(e){ toast(e.payload?.error||e.message) }
    };
  });
}

function parseBudget(goal){
  const m=String(goal).match(/(?:under|max|budget|<=|≤)\s*\$?\s*(\d+(?:\.\d+)?)/i)||String(goal).match(/\$\s*(\d+(?:\.\d+)?)/);
  return m?Number(m[1]):null;
}
function scoreSkill(sk, goal){
  const g=goal.toLowerCase();
  const blob=((sk.name||"")+" "+(sk.description||"")+" "+(sk.category||"")+" "+(sk.id||"")).toLowerCase();
  let score=0;
  g.split(/[^a-z0-9]+/).filter(w=>w.length>2).forEach(w=>{ if(blob.includes(w)) score+=2 });
  if(/snipe|bid|auction/.test(g)&&/snipe|bid|auction/.test(blob)) score+=5;
  if(/price|watch|market/.test(g)&&/price|watch|market/.test(blob)) score+=4;
  if(/risk|cap|overbid/.test(g)&&/risk|guard/.test(blob)) score+=4;
  if(/bargain|offer/.test(g)&&/bargain|coach/.test(blob)) score+=4;
  if(/catalog|discover|radar/.test(g)&&/catalog|radar|discover/.test(blob)) score+=4;
  return score;
}
async function runOrchestrator(goal){
  const g=String(goal||"").trim();
  const out={orchestrator:"lvl-orchestrator-v2",goal:g,status:"needs_human",plan:[],actions:[],selected_skill_id:null,quote_usdc:null,pay_to:null,mandate_id:null,tx_hash:null,proof_ok:false,budget:{max_usdc:parseBudget(g),spent_usdc:0,remaining_usdc:null,pending_quote_usdc:null},specialists_used:[],evidence:[],risks:[],next_action:"",human_gate:null,surface:"agentic",fee_rate:FEE,version:"1.7.0"};
  if(!g){out.next_action="provide_goal";out.human_gate={question:"What should we do?",options:["buy Bid Sniper under 10","scan open auctions","equip owned skills"]};return out;}
  const max=out.budget.max_usdc;
  out.specialists_used.push("scout","risk");
  out.plan.push({step:1,who:"scout",action:"GET /api/agent + /api/me + /api/skills"});
  out.actions.push({method:"GET",path:"/api/agent",purpose:"first_contact"},{method:"GET",path:"/api/me",purpose:"balance"},{method:"GET",path:"/api/skills",purpose:"catalog"});
  try{
    const [agent,meRes,skillsRes]=await Promise.all([api("/api/agent"),api("/api/me"),api("/api/skills")]);
    applyMe(meRes.me);
    const bal=Number(meRes.me?.balance_usdc??meRes.me?.balanceUsdc??S.balance??0);
    out.budget.remaining_usdc=max==null?bal:Math.min(bal,max);
    out.evidence.push({kind:"api",url:"/api/agent",digest:"v"+(agent.version||"?")+" fee "+agent.fee_rate});
    out.evidence.push({kind:"api",url:"/api/me",digest:"balance "+money(bal)+" USDC"});
    const skills=skillsRes.skills||[];
    const ranked=[...skills].map(sk=>({sk,score:scoreSkill(sk,g)})).sort((a,b)=>b.score-a.score);
    const top=ranked.filter(x=>x.score>0).slice(0,3);
    const marketGoal=/auction|market|bid|buy\s+now|listing|flash/.test(g.toLowerCase())&&!/skill|snipe|watcher|coach|radar|guard|equip/.test(g.toLowerCase());
    const equipGoal=/equip/.test(g.toLowerCase());
    if(marketGoal){
      out.actions.push({method:"GET",path:"/api/auctions",purpose:"open_auctions"});
      const auctionsRes=await api("/api/auctions");
      const openA=(auctionsRes.auctions||[]).filter(a=>a.status==="open");
      out.evidence.push({kind:"api",url:"/api/auctions",digest:"open "+openA.length});
      out.specialists_used.push("trader");
      out.plan.push({step:2,who:"trader",action:"Surface open auctions + fee if won"});
      if(!openA.length){out.status="blocked";out.risks.push("no_open_auctions");out.next_action="open_markets_or_create_listing";return out;}
      const a=openA[0];
      const high=Number(a.current_high_bid??a.highBidUsdc??0);
      const minInc=Number(a.minIncrementUsdc??0.5);
      const next=a.sealed?(a.reserveUsdc||1):high+minInc;
      out.quote_usdc=next;out.budget.pending_quote_usdc=next;
      out.human_gate={question:"Bid "+money(next)+" on "+(a.title||a.id)+"? Fee if won ~"+money(feeOf(next)),auction_id:a.id,amount_usdc:next,options:["place_bid","cancel"]};
      out.status=(bal>=next && (max==null||next<=max))?"ready_to_settle":"blocked";
      if(bal<next) out.risks.push("insufficient_balance");
      if(max!=null&&next>max) out.risks.push("over_budget");
      out.next_action=out.status==="ready_to_settle"?("POST /api/auctions/"+a.id+"/bids"):"raise_budget_or_pick_cheaper";
      out.plan.push({step:3,who:"human",action:"Confirm bid"});
      return out;
    }
    if(equipGoal){
      out.specialists_used.push("installer");
      const owned=[...S.owned];
      const notEq=owned.filter(id=>!S.equipped.has(id));
      if(!notEq.length){out.status=owned.length?"done":"blocked";out.risks.push(owned.length?"all_equipped":"no_owned_skills");out.next_action=owned.length?"noop":"purchase_skill_first";return out;}
      out.selected_skill_id=notEq[0];
      out.human_gate={question:"Equip "+notEq[0]+"?",skill_id:notEq[0],options:["equip","cancel"]};
      out.status="needs_human";out.next_action="POST /api/agents/me/skills/equip";
      return out;
    }
    out.specialists_used.push("evaluator","trader");
    out.plan.push({step:2,who:"evaluator",action:"Rank public skills"},{step:3,who:"trader",action:"Price + 3.3% fee vs budget"});
    const pick=(top[0]&&top[0].score>0)?top[0].sk:skills[0];
    if(!pick){out.status="blocked";out.risks.push("empty_skill_catalog");out.next_action="retry_GET_/api/skills";return out;}
    const price=Number(pick.price_usdc??pick.priceUsdc??0);
    const f=feeOf(price); const total=price+f;
    out.selected_skill_id=pick.id;out.quote_usdc=total;out.budget.pending_quote_usdc=total;
    out.evidence.push({kind:"catalog",url:"/api/skills",digest:"pick "+pick.id+" price "+money(price)+"+fee "+money(f)});
    out.evidence.push({kind:"agent_card",url:LVL_PUBLIC.card,digest:"public LVL x402 is separate surface"});
    if(S.owned.has(pick.id)){
      out.status="needs_human";out.risks.push("already_owned");
      out.human_gate={question:"Already owned "+pick.name+". Equip?",skill_id:pick.id,options:["equip","browse_other"]};
      out.next_action="POST equip";return out;
    }
    if(max!=null&&total>max) out.risks.push("over_budget");
    if(bal<total) out.risks.push("insufficient_balance");
    out.human_gate={question:"Buy "+pick.name+" for "+money(price)+" + "+money(f)+" fee (total "+money(total)+")?",skill_id:pick.id,price_usdc:price,fee_usdc:f,total_usdc:total,options:["purchase","cancel"]};
    out.plan.push({step:4,who:"human",action:"Confirm purchase"},{step:5,who:"settler",action:"POST purchase (demo wallet; public x402 separate)"});
    out.actions.push({method:"POST",path:"/api/skills/"+pick.id+"/purchase",purpose:"purchase_skill"});
    out.status=(out.risks.length?"blocked":"ready_to_settle");
    out.next_action=out.status==="ready_to_settle"?("POST /api/skills/"+pick.id+"/purchase"):"raise_budget_or_top_up";
    return out;
  }catch(e){
    out.status="failed";out.risks.push(String(e.payload?.error||e.message||e));out.next_action="retry_first_contact";return out;
  }
}
function formatOrchHuman(o){
  return [
    "Plan: "+((o.plan||[]).map(p=>p.step+"."+p.who+":"+p.action).join(" · ")||"—"),
    "Status: "+o.status,
    "Pick: "+(o.selected_skill_id||"—")+" · quote "+(o.quote_usdc!=null?money(o.quote_usdc):"—")+" USDC",
    "Next: "+(o.next_action||"—"),
    o.human_gate?.question?("Gate: "+o.human_gate.question):null,
    (o.risks&&o.risks.length)?("Risks: "+o.risks.join(", ")):null
  ].filter(Boolean).join("\n");
}
async function orchestrateAndShow(goal, openPanel=true){
  const o=await runOrchestrator(goal); S.lastOrch=o;
  add("bot", formatOrchHuman(o), [
    {l:"Agent panel",i:"agent"},
    ...(o.status==="ready_to_settle"&&o.selected_skill_id&&!o.human_gate?.auction_id?[{l:"Confirm buy",fn:()=>confirmOrchPurchase(o)}]:[]),
    ...(o.human_gate?.auction_id?[{l:"Confirm bid",fn:()=>confirmOrchBid(o)}]:[]),
    ...(o.human_gate?.options?.includes("equip")&&o.selected_skill_id?[{l:"Equip",fn:()=>confirmOrchEquip(o)}]:[])
  ]);
  if(openPanel) await go("agent");
  return o;
}
async function confirmOrchPurchase(o){
  if(!o?.selected_skill_id) return;
  try{
    const j=await api("/api/skills/"+encodeURIComponent(o.selected_skill_id)+"/purchase",{method:"POST",body:"{}"});
    toast(j.already_owned?"Already owned":("Purchased · fee "+money(j.order?.feeUsdc||0)));
    add("bot", j.already_owned?("Already owned "+o.selected_skill_id):("Purchased "+o.selected_skill_id+". Fee 3.3%."),[{l:"Equip",fn:async()=>{await api("/api/agents/me/skills/equip",{method:"POST",body:JSON.stringify({skill_id:o.selected_skill_id})});toast("Equipped");go("skills")}},{l:"Skills",i:"skills"}]);
    S.lastOrch={...o,status:"done",next_action:"equip_or_browse",specialists_used:[...new Set([...(o.specialists_used||[]),"settler"])]};
    await go("agent");
  }catch(e){ toast(e.payload?.error||e.message); }
}
async function confirmOrchBid(o){
  const id=o.human_gate?.auction_id; const amount=o.human_gate?.amount_usdc;
  if(!id) return;
  try{
    const j=await api("/api/auctions/"+encodeURIComponent(id)+"/bids",{method:"POST",body:JSON.stringify({amount_usdc:amount})});
    toast(j.message||("Bid "+money(amount)));
    add("bot","Bid "+money(j.bid?.amountUsdc??amount)+" on "+id+".");
    S.lastOrch={...o,status:"done",next_action:"watch_auction"};
    await go("markets");
  }catch(e){ toast(e.payload?.error||e.message); }
}
async function confirmOrchEquip(o){
  if(!o?.selected_skill_id) return;
  try{ await api("/api/agents/me/skills/equip",{method:"POST",body:JSON.stringify({skill_id:o.selected_skill_id})}); toast("Equipped"); add("bot","Equipped "+o.selected_skill_id); await go("skills"); }
  catch(e){ toast(e.payload?.error||e.message); }
}
async function copyText(label,text){
  try{ await navigator.clipboard.writeText(text); toast("Copied "+label); }catch{ toast("Copy failed"); }
}

async function renderAgent(pb){
  const [agent, actions, pay]=await Promise.all([
    api("/api/agent"),
    api("/api/actions").catch(()=>({actions:[]})),
    api("/api/payments/x402").catch(()=>({}))
  ]);
  const o=S.lastOrch;
  let html=`<div class="card"><h3><span class="live-dot"></span>LVL Orchestrator v2</h3>
    <p>Dual surface: agentic API (fee ${(FEE*100).toFixed(1)}%) + public A2A/MCP/x402 on lvlltd.com.</p>
    <p class="muted" style="margin-top:6px">Specialists: scout · evaluator · trader · settler · installer · scribe · risk</p>
    <div class="row" style="margin-top:10px">
      <button type="button" data-copy="tight">Copy A · Tight</button>
      <button type="button" data-copy="json">Copy B · JSON</button>
      <button type="button" data-copy="full">Copy Full</button>
    </div></div>`;
  html+=`<div class="card"><h3>Run goal</h3>
    <div class="field"><label>Goal</label><input id="orch-goal" placeholder="buy sniper under 10" value="${esc(o?.goal||"buy Bid Sniper under 10")}"/></div>
    <div class="row"><button type="button" class="primary" id="orch-run">Orchestrate</button>
    <span class="orch-chip">proof-before-claim</span></div></div>`;
  if(o){
    html+=`<div class="card"><h3>Last plan <span class="status-pill ${esc(o.status)}">${esc(o.status)}</span></h3>
      <p class="muted">${esc(o.goal||"—")}</p>
      <p style="margin-top:6px">Pick <span class="badge">${esc(o.selected_skill_id||"—")}</span> · quote ${o.quote_usdc!=null?money(o.quote_usdc):"—"} USDC</p>
      <p class="muted" style="margin-top:4px">Next: ${esc(o.next_action||"—")}</p>
      ${o.human_gate?.question?`<p class="warn" style="margin-top:8px">${esc(o.human_gate.question)}</p>`:""}
      ${(o.risks&&o.risks.length)?`<p class="err">Risks: ${esc(o.risks.join(", "))}</p>`:""}
      <div class="row">
        ${o.status==="ready_to_settle"&&o.selected_skill_id&&!o.human_gate?.auction_id?`<button type="button" class="primary" id="orch-buy">Confirm purchase</button>`:""}
        ${o.human_gate?.auction_id?`<button type="button" class="primary" id="orch-bid">Confirm bid</button>`:""}
        ${o.human_gate?.options?.includes("equip")&&o.selected_skill_id?`<button type="button" id="orch-equip">Equip</button>`:""}
        <button type="button" id="orch-copy-json">Copy status JSON</button>
      </div>
      <pre class="json" id="orch-json">${esc(JSON.stringify(o,null,2))}</pre>
    </div>`;
  } else {
    html+=`<div class="card"><h3>No run yet</h3><p class="muted">Enter a goal or chat “orchestrate buy sniper under 10”.</p></div>`;
  }
  html+=`<div class="card"><h3>${esc(agent.name||"LVL")}</h3>
    <p>v${esc(agent.version)} · fee ${((agent.fee_rate??FEE)*100).toFixed(1)}% · <code>/api/agent</code></p>
    <p class="muted">open ${esc(agent.stats?.open_auctions)} · orders ${esc(agent.stats?.orders)} · bal ${money(agent.stats?.balance_usdc??S.balance)}</p>
    <div class="row" style="margin-top:8px">
      <a class="badge" href="/api/openapi.json" target="_blank" rel="noopener">OpenAPI</a>
      <a class="badge" href="/api/me" target="_blank" rel="noopener">/api/me</a>
      <a class="badge" href="/api/payments/x402" target="_blank" rel="noopener">x402 stub</a>
    </div></div>`;
  html+=`<div class="card"><h3>Protocol stack</h3>
    <p><span class="pill">A2A</span> public lvlltd.com/api/a2a</p>
    <p><span class="pill">MCP</span> public lvlltd.com/api/mcp</p>
    <p><span class="pill">x402</span> ${esc(pay.rail?.status||"stub")} · ${esc(pay.rail?.chain||"base")} ${esc(pay.rail?.asset||"USDC")}</p>
    <p class="muted" style="margin-top:8px">Public x402 never settles inside A2A/MCP. Agentic demo wallet is separate (3.3%).</p>
  </div>`;
  const steps=agent.first_contact?.steps||[];
  html+=`<div class="card"><h3>First contact</h3>`;
  if(steps.length){ for(const st of steps) html+=`<p>${esc(st.n)}. ${esc(st.method)} ${esc(st.path)} — ${esc(st.why||"")}</p>`; }
  else {
    html+=`<p>1. ${esc(agent.first_contact?.step_1||"GET /api/agent")}</p>
    <p>2. ${esc(agent.first_contact?.step_2||"GET /api/openapi.json")}</p>
    <p>3. ${esc(agent.first_contact?.step_3||"act")}</p>`;
  }
  html+=`</div>`;
  html+=`<p class="muted">Actions (${(actions.actions||[]).length})</p>`;
  for(const a of (actions.actions||[]).slice(0,12)) html+=`<div class="card"><h3>${esc(a.name)}</h3><p>${esc(a.method)} ${esc(a.path)}</p></div>`;
  pb.innerHTML=html;
  pb.querySelectorAll("[data-copy]").forEach(btn=>{ btn.onclick=()=>copyText(btn.dataset.copy, PROMPTS[btn.dataset.copy]||""); });
  const run=$("orch-run");
  if(run) run.onclick=async()=>{ run.disabled=true; try{ await orchestrateAndShow(($("orch-goal").value||"").trim(),true);} finally{ run.disabled=false; } };
  const buy=$("orch-buy"); if(buy) buy.onclick=()=>confirmOrchPurchase(S.lastOrch);
  const bid=$("orch-bid"); if(bid) bid.onclick=()=>confirmOrchBid(S.lastOrch);
  const eqb=$("orch-equip"); if(eqb) eqb.onclick=()=>confirmOrchEquip(S.lastOrch);
  const cj=$("orch-copy-json"); if(cj) cj.onclick=()=>copyText("status JSON", JSON.stringify(S.lastOrch,null,2));
}

function handleChat(raw){
  const v=raw.trim(); if(!v) return;
  add("user",v); $("in").value="";
  const t=v.toLowerCase();
  const orch=t.match(/^(?:orchestrate|orch|plan)\s*[:\-]?\s*(.*)$/i)||t.match(/^o\s+(.+)$/i);
  if(orch){ const goal=(orch[1]||"").trim()||"buy Bid Sniper under 10"; add("bot","Running orchestrator v2…"); return orchestrateAndShow(goal,true); }
  if(/orchestrat|specialist|a2a|x402|prompt/.test(t)){ add("bot","Agent panel has Orchestrator v2 — run a goal or copy prompts.",[{l:"Open Agent",i:"agent"}]); return go("agent"); }

  if(/flash|close|lifecycle/.test(t)){ add("bot","Opening markets — use Flash Lot or Close now to exercise the lifecycle."); return go("markets") }
  if(/skill/.test(t)){ add("bot","Opening skills."); return go("skills") }
  if(/sell|list/.test(t)){ add("bot","Opening sell."); return go("sell") }
  if(/order|balance|equip/.test(t)){ add("bot","Opening orders & balance."); return go("orders") }
  if(/agent|api|openapi/.test(t)){ add("bot","Agent surface under /api/*."); return go("agent") }
  if(/market|auction|bid|shop|buy/.test(t)){ add("bot","Opening live markets."); return go("markets") }
  add("bot","Try Markets, Skills, Sell, Orders, or Agent.",[{l:"Markets",i:"markets"},{l:"Orders",i:"orders"},{l:"Skills",i:"skills"}]);
}
function closePanel(){ $("panel").classList.remove("open"); $("panel").setAttribute("aria-hidden","true"); const scr=$("scrim"); if(scr) scr.classList.remove("on"); }
$("m").onclick=()=>{ if($("panel").classList.contains("open")) closePanel(); else go(S.p||"markets"); };
$("x").onclick=closePanel;
const scrimEl=$("scrim"); if(scrimEl) scrimEl.onclick=closePanel;
$("bal").onclick=()=>go("orders");
document.querySelectorAll(".nav button").forEach(b=>b.onclick=()=>go(b.dataset.p));
$("send").onclick=()=>handleChat($("in").value);
$("in").addEventListener("keydown",e=>{if(e.key==="Enter")$("send").click()});
const v=$("bgv"); v.muted=true; v.play().catch(()=>{});
v.addEventListener("error",()=>{ if(v.dataset.cdn) return; v.dataset.cdn="1"; v.src=CDN_VIDEO; v.poster=CDN_POSTER; v.load(); v.play().catch(()=>{}) });
v.addEventListener("playing",()=>{$("poster").style.opacity="0"; $("poster").style.transition="opacity .6s"});
add("bot","Welcome to LVL — markets, skills, 3.3% fee. Orchestrator v2 on Agent (copy A/B or run a goal).",
  [{l:"Agent + Orch",i:"agent"},{l:"Markets",i:"markets"},{l:"Skills",i:"skills"}]);
refreshMe().then(()=>go("markets"));
setInterval(()=>{ if(S.p==="markets" && $("panel").classList.contains("open")) go("markets"); }, 30000);
