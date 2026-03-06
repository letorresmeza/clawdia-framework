import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryBus } from "@clawdia/core";
import type { AgentIdentity } from "@clawdia/types";
import { BillingEngine } from "../billing/billing-engine.js";
import { OrderBook } from "../marketplace/order-book.js";
import { PricingEngine } from "../marketplace/pricing-engine.js";
import { ResourceMarketplace } from "../marketplace/marketplace.js";

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function makeIdentity(name: string): AgentIdentity {
  return {
    name,
    displayName: name,
    description: `Agent ${name}`,
    version:     "1.0.0",
    operator:    "test",
    publicKey:   `key-${name}`,
    capabilities:  [],
    requirements:  [],
    runtime:       {},
  };
}

// ─────────────────────────────────────────────────────────
// OrderBook
// ─────────────────────────────────────────────────────────

describe("OrderBook", () => {
  let book: OrderBook;

  beforeEach(() => {
    book = new OrderBook();
  });

  describe("listResource()", () => {
    it("creates a listing with a unique id", () => {
      const listing = book.listResource({
        seller:      "seller-1",
        type:        "compute_cpu",
        quantity:    100,
        pricePerUnit: 0.05,
        unit:        "cpu-min",
        currency:    "USDC",
        listingType: "spot",
      });

      expect(listing.id).toBeDefined();
      expect(listing.seller).toBe("seller-1");
      expect(listing.quantity).toBe(100);
      expect(listing.pricePerUnit).toBe(0.05);
    });

    it("multiple listings accumulate in the book", () => {
      book.listResource({ seller: "s1", type: "api_credits", quantity: 50,  pricePerUnit: 0.002, unit: "credit",  currency: "USDC", listingType: "spot" });
      book.listResource({ seller: "s2", type: "api_credits", quantity: 200, pricePerUnit: 0.003, unit: "credit",  currency: "USDC", listingType: "spot" });

      const apiListings = book.getListingsByType("api_credits");
      expect(apiListings).toHaveLength(2);
    });
  });

  describe("cancelListing()", () => {
    it("removes a listing owned by seller", () => {
      const l = book.listResource({ seller: "s1", type: "data_feed", quantity: 10, pricePerUnit: 0.1, unit: "MB", currency: "USDC", listingType: "spot" });
      expect(book.cancelListing(l.id, "s1")).toBe(true);
      expect(book.getListing(l.id)).toBeUndefined();
    });

    it("rejects cancellation by wrong seller", () => {
      const l = book.listResource({ seller: "s1", type: "data_feed", quantity: 10, pricePerUnit: 0.1, unit: "MB", currency: "USDC", listingType: "spot" });
      expect(book.cancelListing(l.id, "attacker")).toBe(false);
      expect(book.getListing(l.id)).toBeDefined();
    });
  });

  describe("matchOrder()", () => {
    it("matches buyer to cheapest listing", () => {
      book.listResource({ seller: "expensive", type: "api_credits", quantity: 100, pricePerUnit: 0.01,  unit: "credit", currency: "USDC", listingType: "spot" });
      book.listResource({ seller: "cheap",     type: "api_credits", quantity: 100, pricePerUnit: 0.002, unit: "credit", currency: "USDC", listingType: "spot" });

      const fill = book.matchOrder(
        { buyer: "buyer-1", type: "api_credits", quantity: 10, currency: "USDC" },
        0.0021, // buyer price with spread
        0.0001, // platform fee
      );

      expect(fill).not.toBeNull();
      expect(fill!.listing.seller).toBe("cheap");
      expect(fill!.rawUnitPrice).toBe(0.002);
      expect(fill!.quantityFilled).toBe(10);
    });

    it("partially fills when listing has less than requested", () => {
      book.listResource({ seller: "s1", type: "compute_cpu", quantity: 5, pricePerUnit: 0.05, unit: "cpu-min", currency: "USDC", listingType: "spot" });

      const fill = book.matchOrder(
        { buyer: "buyer", type: "compute_cpu", quantity: 20, currency: "USDC" },
        0.0525, 0.0025,
      );

      expect(fill!.quantityFilled).toBe(5);
    });

    it("returns null when no listings available", () => {
      const fill = book.matchOrder(
        { buyer: "buyer", type: "compute_gpu", quantity: 1, currency: "USDC" },
        0.5, 0.025,
      );
      expect(fill).toBeNull();
    });

    it("respects maxPricePerUnit", () => {
      book.listResource({ seller: "s1", type: "compute_cpu", quantity: 100, pricePerUnit: 0.10, unit: "cpu-min", currency: "USDC", listingType: "spot" });

      const fill = book.matchOrder(
        { buyer: "buyer", type: "compute_cpu", quantity: 10, currency: "USDC", maxPricePerUnit: 0.05 },
        0.0525, 0.0025,
      );
      expect(fill).toBeNull(); // listing price 0.10 > max 0.05
    });

    it("removes listing when fully consumed", () => {
      const l = book.listResource({ seller: "s1", type: "api_credits", quantity: 10, pricePerUnit: 0.002, unit: "credit", currency: "USDC", listingType: "spot" });
      book.matchOrder({ buyer: "b", type: "api_credits", quantity: 10, currency: "USDC" }, 0.0021, 0.0001);

      expect(book.getListing(l.id)).toBeUndefined();
    });

    it("updates seller stats after fill", () => {
      book.listResource({ seller: "top-seller", type: "api_credits", quantity: 100, pricePerUnit: 0.002, unit: "credit", currency: "USDC", listingType: "spot" });
      book.matchOrder({ buyer: "b1", type: "api_credits", quantity: 50, currency: "USDC" }, 0.0021, 0.0001);
      book.matchOrder({ buyer: "b2", type: "api_credits", quantity: 30, currency: "USDC" }, 0.0021, 0.0001);

      const top = book.topSellers(1);
      expect(top[0]!.seller).toBe("top-seller");
      expect(top[0]!.orders).toBe(2);
      expect(top[0]!.volume).toBeCloseTo(0.16, 3); // (50+30) × 0.002
    });
  });

  describe("filledVolume() / activeCapacity()", () => {
    it("tracks capacity and fills correctly", () => {
      book.listResource({ seller: "s1", type: "compute_cpu", quantity: 200, pricePerUnit: 0.05, unit: "cpu-min", currency: "USDC", listingType: "spot" });
      expect(book.activeCapacity("compute_cpu")).toBe(200);

      book.matchOrder({ buyer: "b", type: "compute_cpu", quantity: 50, currency: "USDC" }, 0.0525, 0.0025);
      expect(book.activeCapacity("compute_cpu")).toBe(150);
      expect(book.filledVolume("compute_cpu")).toBe(50);
    });
  });
});

// ─────────────────────────────────────────────────────────
// PricingEngine
// ─────────────────────────────────────────────────────────

describe("PricingEngine", () => {
  let pricing: PricingEngine;

  beforeEach(() => {
    pricing = new PricingEngine({
      highUtilizationThreshold: 0.80,
      lowUtilizationThreshold:  0.40,
      priceIncreaseRate:        0.10,
      priceDecreaseRate:        0.05,
    });
  });

  it("starts at base price", () => {
    expect(pricing.getPrice("compute_cpu")).toBe(0.05);
    expect(pricing.getPrice("api_credits")).toBe(0.002);
  });

  it("increases price when utilization > 80%", () => {
    const base = pricing.getPrice("compute_cpu");

    // List 100, fill 85 → utilization 85% > 80%
    pricing.recordListing("compute_cpu", 100);
    pricing.recordFill("compute_cpu", 85);

    expect(pricing.getPrice("compute_cpu")).toBeGreaterThan(base);
  });

  it("decreases price when utilization < 40%", () => {
    const base = pricing.getPrice("api_credits");

    // List 100, fill 10 → utilization 10% < 40%
    pricing.recordListing("api_credits", 100);
    pricing.recordFill("api_credits", 10);

    expect(pricing.getPrice("api_credits")).toBeLessThan(base);
  });

  it("price stays stable in the 40–80% zone", () => {
    const base = pricing.getPrice("data_feed");

    pricing.recordListing("data_feed", 100);
    pricing.recordFill("data_feed", 60); // 60% utilization → unchanged

    expect(pricing.getPrice("data_feed")).toBe(base);
  });

  it("clamps price at floor (50% of base)", () => {
    const base = pricing.getPrice("api_credits");

    // Repeatedly decrease (0 fills → price keeps dropping)
    pricing.recordListing("api_credits", 1000);
    for (let i = 0; i < 50; i++) {
      pricing.recordFill("api_credits", 0);
      // Re-listing to keep supply high, demand low
    }

    expect(pricing.getPrice("api_credits")).toBeGreaterThanOrEqual(base * 0.50);
  });

  it("clamps price at ceiling (5× base)", () => {
    const base = pricing.getPrice("compute_gpu");

    // Drive utilization to 100% repeatedly
    for (let i = 0; i < 100; i++) {
      pricing.recordListing("compute_gpu", 10);
      pricing.recordFill("compute_gpu", 10);
    }

    expect(pricing.getPrice("compute_gpu")).toBeLessThanOrEqual(base * 5);
  });

  it("allPrices() returns info for all resource types", () => {
    const prices = pricing.allPrices();
    expect(prices["compute_cpu"]).toBeDefined();
    expect(prices["compute_gpu"]).toBeDefined();
    expect(prices["api_credits"]).toBeDefined();
    expect(prices["data_feed"]).toBeDefined();
    expect(prices["context_window"]).toBeDefined();
  });

  it("utilization() returns 0 when nothing is listed", () => {
    expect(pricing.utilization("compute_gpu")).toBe(0);
  });

  it("recordCancellation() reduces active capacity", () => {
    pricing.recordListing("context_window", 100);
    pricing.recordCancellation("context_window", 40);
    expect(pricing.utilization("context_window")).toBe(0); // 0 filled, 60 remaining
  });
});

// ─────────────────────────────────────────────────────────
// ResourceMarketplace
// ─────────────────────────────────────────────────────────

describe("ResourceMarketplace", () => {
  let bus: InMemoryBus;
  let billing: BillingEngine;
  let marketplace: ResourceMarketplace;

  beforeEach(async () => {
    bus = new InMemoryBus();
    await bus.connect();

    billing     = new BillingEngine(bus);
    marketplace = new ResourceMarketplace(bus, billing, undefined, { spreadPercent: 5 });
  });

  // ── listResource ────────────────────────────────────────

  describe("listResource()", () => {
    it("creates a listing at the current dynamic price if none provided", () => {
      const listing = marketplace.listResource({
        seller:      "gpu-provider",
        type:        "compute_gpu",
        quantity:    50,
        currency:    "USDC",
        listingType: "spot",
      });

      expect(listing.id).toBeDefined();
      expect(listing.pricePerUnit).toBe(0.50); // base price
    });

    it("respects an explicit pricePerUnit", () => {
      const listing = marketplace.listResource({
        seller:       "cpu-provider",
        type:         "compute_cpu",
        quantity:     200,
        pricePerUnit: 0.03,
        currency:     "USDC",
        listingType:  "spot",
      });

      expect(listing.pricePerUnit).toBe(0.03);
    });

    it("publishes marketplace.listed on the bus", async () => {
      const received: unknown[] = [];
      bus.subscribe("marketplace.listed", async (msg) => {
        received.push(msg.payload);
      });

      marketplace.listResource({ seller: "s1", type: "api_credits", quantity: 100, currency: "USDC", listingType: "spot" });

      expect(received).toHaveLength(1);
    });

    it("updates pricing engine active capacity", () => {
      marketplace.listResource({ seller: "s1", type: "compute_cpu", quantity: 500, currency: "USDC", listingType: "spot" });
      const prices = marketplace.allPrices();
      expect(prices["compute_cpu"]!.activeListings).toBe(500);
    });
  });

  // ── buyResource ─────────────────────────────────────────

  describe("buyResource()", () => {
    it("returns null when no listings available", () => {
      const order = marketplace.buyResource({ buyer: "agent-1", type: "compute_gpu", quantity: 1, currency: "USDC" });
      expect(order).toBeNull();
    });

    it("fills an order with 5% spread applied", () => {
      marketplace.listResource({ seller: "seller", type: "api_credits", quantity: 1000, pricePerUnit: 0.002, currency: "USDC", listingType: "spot" });

      const order = marketplace.buyResource({ buyer: "buyer", type: "api_credits", quantity: 100, currency: "USDC" });

      expect(order).not.toBeNull();
      expect(order!.quantity).toBe(100);
      // buyer price = 0.002 × 1.05 = 0.0021
      expect(order!.pricePerUnit).toBeCloseTo(0.0021, 4);
      expect(order!.totalPrice).toBeCloseTo(0.21, 4);
    });

    it("records platform fee in billing", () => {
      marketplace.listResource({ seller: "seller", type: "api_credits", quantity: 1000, pricePerUnit: 0.002, currency: "USDC", listingType: "spot" });
      marketplace.buyResource({ buyer: "buyer", type: "api_credits", quantity: 100, currency: "USDC" });

      const platformRecords = billing.listRecords().filter(
        (r) => r.agentName === "platform" && r.resourceType === "marketplace.spread",
      );
      expect(platformRecords).toHaveLength(1);
      expect(platformRecords[0]!.cost).toBeCloseTo(0.01, 4); // 5% of 0.20
    });

    it("records buyer usage in billing", () => {
      marketplace.listResource({ seller: "s", type: "compute_cpu", quantity: 100, pricePerUnit: 0.05, currency: "USDC", listingType: "spot" });
      marketplace.buyResource({ buyer: "agent-x", type: "compute_cpu", quantity: 10, currency: "USDC" });

      const buyerRecords = billing.listRecords().filter(
        (r) => r.agentName === "agent-x",
      );
      expect(buyerRecords).toHaveLength(1);
      expect(buyerRecords[0]!.resourceType).toBe("marketplace.compute_cpu");
    });

    it("publishes marketplace.filled on the bus", async () => {
      marketplace.listResource({ seller: "s1", type: "data_feed", quantity: 50, pricePerUnit: 0.1, currency: "USDC", listingType: "spot" });

      const events: unknown[] = [];
      bus.subscribe("marketplace.filled", async (msg) => {
        events.push(msg.payload);
      });

      marketplace.buyResource({ buyer: "b1", type: "data_feed", quantity: 10, currency: "USDC" });
      expect(events).toHaveLength(1);
    });

    it("respects maxPricePerUnit — returns null if too expensive", () => {
      marketplace.listResource({ seller: "s", type: "compute_gpu", quantity: 10, pricePerUnit: 1.00, currency: "USDC", listingType: "spot" });

      const order = marketplace.buyResource({
        buyer:            "cheapskate",
        type:             "compute_gpu",
        quantity:         5,
        currency:         "USDC",
        maxPricePerUnit:  0.30, // listing at 1.00 → no match
      });
      expect(order).toBeNull();
    });
  });

  // ── Dynamic pricing ──────────────────────────────────────

  describe("dynamic pricing", () => {
    it("price rises after high demand fills listings", () => {
      const basePrice = marketplace.getPrice("api_credits");

      // List 100, fill 90 → utilization 90% > 80%
      marketplace.listResource({ seller: "s1", type: "api_credits", quantity: 100, pricePerUnit: 0.002, currency: "USDC", listingType: "spot" });
      marketplace.buyResource({ buyer: "b1", type: "api_credits", quantity: 90, currency: "USDC" });

      expect(marketplace.getPrice("api_credits")).toBeGreaterThan(basePrice);
    });

    it("price falls after low demand", () => {
      const basePrice = marketplace.getPrice("data_feed");

      // List 200, fill only 20 → utilization 10% < 40%
      marketplace.listResource({ seller: "s1", type: "data_feed", quantity: 200, pricePerUnit: 0.10, currency: "USDC", listingType: "spot" });
      marketplace.buyResource({ buyer: "b1", type: "data_feed", quantity: 20, currency: "USDC" });

      expect(marketplace.getPrice("data_feed")).toBeLessThan(basePrice);
    });
  });

  // ── Platform revenue ─────────────────────────────────────

  describe("platform revenue", () => {
    it("accumulates revenue across multiple trades", () => {
      marketplace.listResource({ seller: "s", type: "api_credits", quantity: 1000, pricePerUnit: 0.002, currency: "USDC", listingType: "spot" });
      marketplace.buyResource({ buyer: "b1", type: "api_credits", quantity: 100, currency: "USDC" });
      marketplace.buyResource({ buyer: "b2", type: "api_credits", quantity: 200, currency: "USDC" });

      const stats = marketplace.stats();
      expect(stats.platformRevenue).toBeCloseTo(0.03, 4); // 5% of (0.20 + 0.40)
    });
  });

  // ── Stats ────────────────────────────────────────────────

  describe("stats()", () => {
    it("returns prices, topSellers, recentOrders, totals", () => {
      marketplace.listResource({ seller: "alice", type: "compute_cpu", quantity: 100, pricePerUnit: 0.05, currency: "USDC", listingType: "spot" });
      marketplace.buyResource({ buyer: "bob",   type: "compute_cpu", quantity:  30, currency: "USDC" });
      marketplace.buyResource({ buyer: "carol", type: "compute_cpu", quantity:  20, currency: "USDC" });

      const stats = marketplace.stats();
      expect(stats.prices["compute_cpu"]).toBeDefined();
      expect(stats.totalOrders).toBe(2);
      expect(stats.topSellers).toHaveLength(1);
      expect(stats.topSellers[0]!.seller).toBe("alice");
      expect(stats.recentOrders).toHaveLength(2);
      expect(stats.totalVolume).toBeGreaterThan(0);
    });
  });

  // ── cancelListing ────────────────────────────────────────

  describe("cancelListing()", () => {
    it("removes the listing and updates capacity", () => {
      const l = marketplace.listResource({ seller: "s1", type: "context_window", quantity: 500, currency: "USDC", listingType: "spot" });
      expect(marketplace.listListings()).toHaveLength(1);

      marketplace.cancelListing(l.id, "s1");
      expect(marketplace.listListings()).toHaveLength(0);
    });
  });

  // ── Bus lifecycle ────────────────────────────────────────

  describe("start() / stop()", () => {
    it("is idempotent on start", () => {
      marketplace.start();
      marketplace.start();
      expect(marketplace.isRunning).toBe(true);
      marketplace.stop();
      expect(marketplace.isRunning).toBe(false);
    });
  });

  // ── autoBuy ──────────────────────────────────────────────

  describe("autoBuy()", () => {
    it("returns null when no listings available", () => {
      const result = marketplace.autoBuy("agent-1", "compute_cpu", 50);
      expect(result).toBeNull();
    });

    it("fills from available listing and publishes marketplace.auto.buy", async () => {
      marketplace.listResource({ seller: "cloud", type: "compute_cpu", quantity: 500, pricePerUnit: 0.05, currency: "USDC", listingType: "spot" });

      const events: unknown[] = [];
      bus.subscribe("marketplace.auto.buy", async (msg) => { events.push(msg.payload); });

      const order = marketplace.autoBuy("worker-agent", "compute_cpu", 100);

      expect(order).not.toBeNull();
      expect(order!.quantity).toBe(100);
      expect(events).toHaveLength(1);
    });
  });

  // ── RiskEngine integration ────────────────────────────────

  describe("RiskEngine budget integration", () => {
    it("extends compute budget after buying compute_cpu", async () => {
      const { RiskEngine } = await import("@clawdia/core");
      const risk = new RiskEngine(bus);
      risk.setBudget("worker", { maxComputeMs: 60_000, maxApiCalls: 100, maxSpendUsd: 10 });

      const mp = new ResourceMarketplace(bus, billing, risk, { spreadPercent: 5 });
      mp.listResource({ seller: "cloud", type: "compute_cpu", quantity: 100, pricePerUnit: 0.05, currency: "USDC", listingType: "spot" });
      mp.buyResource({ buyer: "worker", type: "compute_cpu", quantity: 10, currency: "USDC" });

      // 10 units × 60,000 ms = 600,000 extra ms
      const budget = risk.getBudget("worker")!;
      expect(budget.maxComputeMs).toBe(60_000 + 10 * 60_000);
    });

    it("extends api_calls budget after buying api_credits", async () => {
      const { RiskEngine } = await import("@clawdia/core");
      const risk = new RiskEngine(bus);
      risk.setBudget("worker", { maxComputeMs: 60_000, maxApiCalls: 100, maxSpendUsd: 10 });

      const mp = new ResourceMarketplace(bus, billing, risk, { spreadPercent: 5 });
      mp.listResource({ seller: "api-co", type: "api_credits", quantity: 500, pricePerUnit: 0.002, currency: "USDC", listingType: "spot" });
      mp.buyResource({ buyer: "worker", type: "api_credits", quantity: 200, currency: "USDC" });

      const budget = risk.getBudget("worker")!;
      expect(budget.maxApiCalls).toBe(100 + 200);
    });
  });

  // ── auto-buy on risk.budget.exceeded ─────────────────────

  describe("auto-buy on budget exceeded event", () => {
    it("buys compute_cpu when compute budget exceeded", async () => {
      marketplace.listResource({ seller: "cloud", type: "compute_cpu", quantity: 500, pricePerUnit: 0.05, currency: "USDC", listingType: "spot" });
      marketplace.start();

      const bought: unknown[] = [];
      bus.subscribe("marketplace.filled", async (msg) => { bought.push(msg.payload); });

      await bus.publish(
        "risk.budget.exceeded",
        {
          type:    "budget_exceeded",
          agent:   "stressed-agent",
          details: { compute: "300000/300000ms" },
        },
        makeIdentity("risk-engine"),
      );

      expect(bought.length).toBeGreaterThan(0);
      marketplace.stop();
    });
  });
});

// ─────────────────────────────────────────────────────────
// Multi-listing order routing
// ─────────────────────────────────────────────────────────

describe("Multi-listing routing", () => {
  it("routes to cheapest listing across multiple sellers", async () => {
    const bus = new InMemoryBus();
    await bus.connect();
    const billing = new BillingEngine(bus);
    const mp = new ResourceMarketplace(bus, billing, undefined, { spreadPercent: 5 });

    mp.listResource({ seller: "expensive-cloud", type: "compute_cpu", quantity: 100, pricePerUnit: 0.10,  currency: "USDC", listingType: "spot" });
    mp.listResource({ seller: "mid-tier",        type: "compute_cpu", quantity: 100, pricePerUnit: 0.05,  currency: "USDC", listingType: "spot" });
    mp.listResource({ seller: "budget-compute",  type: "compute_cpu", quantity: 100, pricePerUnit: 0.025, currency: "USDC", listingType: "spot" });

    const order = mp.buyResource({ buyer: "smart-buyer", type: "compute_cpu", quantity: 10, currency: "USDC" });

    // Should have matched against budget-compute at 0.025
    // buyer price = 0.025 × 1.05 = 0.02625
    expect(order!.pricePerUnit).toBeCloseTo(0.02625, 4);
  });
});
