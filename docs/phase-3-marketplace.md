# Phase 3 Marketplace Guide

Phase 3 adds the marketplace and operator-layer primitives for brokered agent commerce.

## Implemented Components

- `CapabilityMarketplace`: searchable capability offers across operators
- `AuctionNegotiator`: auction-based capability bidding and winner selection
- `subscription` pricing model support in `soul.md`
- `createWorkflowAgent()`: composition helper for workflow agents
- `@clawdia/plugin-runtime-wasm`: WebAssembly runtime provider
- `@clawdia/plugin-observability-prometheus-otel`: Prometheus and tracing plugin
- Tenant-aware filtering in dashboard API routes

## Capability Marketplace

Use the capability marketplace to surface offers derived from the service registry:

```ts
const marketplace = new CapabilityMarketplace(registry);
const offers = marketplace.search({
  taxonomy: "analysis.market.*",
  operator: "alpha",
  pricingModel: "subscription",
});
```

## Auction Negotiation

Use the auction negotiator when a requester wants competing bids:

```ts
const auction = negotiator.createAuction({
  capability: "code.write.typescript",
  requester: "buyer-1",
  maxBudget: 10,
  currency: "USDC",
  deadlineAt: new Date(Date.now() + 60_000).toISOString(),
});

negotiator.placeBid(auction.id, { agent, amount: 7, currency: "USDC" });
const result = negotiator.closeAuction(auction.id);
```

## Workflow Agents

Compose first-class workflow agents with the SDK:

```ts
const agent = await createWorkflowAgent({
  soulMd,
  bus,
  registry,
  contracts,
  steps: [
    { agentName: "researcher", capability: "research.web", payment: { amount: 0.1, currency: "USDC" } },
    { agentName: "writer", capability: "content.write", payment: { amount: 0.2, currency: "USDC" } },
  ],
});
```

## Dashboard Tenants

Dashboard API routes now accept a `tenant` query string on key endpoints:

- `/api/registry?tenant=<operator>`
- `/api/contracts?tenant=<operator>`
- `/api/orchestration?tenant=<operator>`
- `/api/sessions?tenant=<operator>`
