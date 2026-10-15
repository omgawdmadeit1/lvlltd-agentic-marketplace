// WebMCP: expose the storefront's real navigation and offer list to in-browser AI agents.
(()=>{const mc=document.modelContext||navigator.modelContext;if(!mc||typeof mc.registerTool!=='function')return;
const ac=new AbortController();const reg=t=>{try{const p=mc.registerTool(t,{signal:ac.signal});p&&p.catch&&p.catch(()=>{})}catch(e){}};
reg({name:'lvl_list_card_offers',description:'List the $0.99 skill packs on this page with their card (Stripe Payment Link) and wallet links.',
inputSchema:{type:'object',properties:{}},
execute:async()=>{const out=[...document.querySelectorAll('article')].map(a=>{const t=a.querySelector('h3');const c=a.querySelector('a[href*="buy.stripe.com"]');const w=a.querySelector('a[href*="lvlltd.com/hub/marketplace"]');return t&&c?{title:t.textContent.trim(),card:c.href,wallet:w?w.href:null}:null}).filter(Boolean);return{content:[{type:'text',text:JSON.stringify(out)}]}}});
reg({name:'lvl_navigate',description:'Open a page on agentic.lvlltd.com: "home" or "buy".',
inputSchema:{type:'object',properties:{target:{type:'string',enum:['home','buy']}},required:['target']},
execute:async({target})=>{location.href=target==='buy'?'/buy':'/';return{content:[{type:'text',text:'Opening '+(target==='buy'?'/buy':'/')}]}}});
window.addEventListener('pagehide',()=>ac.abort());})();
