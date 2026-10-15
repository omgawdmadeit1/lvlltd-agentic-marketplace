---
name: lvl-agentic-storefront
description: Use agentic.lvlltd.com — find the two $0.99 skill packs (card or wallet) and call the demo market API.
---

# agentic.lvlltd.com

## Buy a pack (human checkout)
- Card: open the Stripe Payment Link on https://agentic.lvlltd.com/buy (x402 Merchant OS, Cold-Start Catalog Bootstrapper; $0.99 each).
- Wallet: https://lvlltd.com/hub/marketplace/?buy=<skill_id>&pay=1 (x402, USDC on Base, settles on lvlltd.com).

## API on this host
1. `GET https://agentic.lvlltd.com/api/agent` for the description and next actions.
2. `GET https://agentic.lvlltd.com/api/openapi.json` for the OpenAPI 3.1 document.
3. `GET https://agentic.lvlltd.com/api/health`.

Honesty notes: auctions, listings, balances and orders here are an in-memory demo. The x402 rail is a stub and `POST /api/payments/x402/confirm` returns 402 `not_a_settlement`. Real x402 settlement: https://lvlltd.com/api/pay. No OAuth and no MCP server on this host; the MCP server is https://lvlltd.com/mcp.
