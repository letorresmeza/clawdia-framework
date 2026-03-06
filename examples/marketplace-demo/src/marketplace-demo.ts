/**
 * Marketplace Demo — Agents buying and selling compute credits
 *
 * Scenario:
 *   • 3 cloud providers seed the marketplace with compute, API credits, and
 *     data-feed resources.
 *   • 5 worker agents run a multi-step analysis workflow. Each step consumes
 *     compute. When an agent's budget runs low it buys more compute autonomously.
 *   • After the workflow, we print a full market summary:
 *     prices, volumes, top sellers, and platform revenue.
 *
 * Run:  pnpm --filter @clawdia/example-marketplace-demo demo
 */

import { InMemoryBus, RiskEngine } from "@clawdia/core";
import { BillingEngine, ResourceMarketplace } from "@clawdia/economy";
import type { ResourceType } from "@clawdia/types";

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function log(section: string, msg: string) {
  console.log(`\x1b[36m[${section}]\x1b[0m ${msg}`);
}

function header(title: string) {
  const line = "─".repeat(60);
  console.log(`\n\x1b[1m${line}\n  ${title}\n${line}\x1b[0m\n`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(n: number, decimals = 4): string {
  return `$${n.toFixed(decimals)}`;
}

// ─────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────

async function main() {
  header("Clawdia Resource Marketplace Demo");

  const bus     = new InMemoryBus();
  await bus.connect();

  const billing     = new BillingEngine(bus);
  const riskEngine  = new RiskEngine(bus, {
    failureThreshold: 5,
    resetTimeoutMs:   30_000,
    defaultBudget: {
      maxComputeMs: 300_000,
      maxApiCalls:  500,
      maxSpendUsd:  5,
    },
  });

  const marketplace = new ResourceMarketplace(bus, billing, riskEngine, {
    spreadPercent:            5,
    highUtilizationThreshold: 0.80,
    lowUtilizationThreshold:  0.40,
    priceIncreaseRate:        0.10,
    priceDecreaseRate:        0.05,
    autoBuyQuantity:          200,
  });

  billing.start();
  riskEngine.start();
  marketplace.start();

  // Listen for price changes
  bus.subscribe("marketplace.price.changed", async (msg) => {
    const p = msg.payload as { type: string; current: number; base: number; utilization: number };
    log(
      "PRICE",
      `${p.type.padEnd(16)} ${fmt(p.current, 5)}  (base ${fmt(p.base, 5)})  util ${(p.utilization * 100).toFixed(0)}%`,
    );
  });

  // Listen for auto-buys
  bus.subscribe("marketplace.auto.buy", async (msg) => {
    const p = msg.payload as { agentName: string; type: string; quantity: number; totalPrice: number };
    log("AUTO-BUY", `${p.agentName} auto-purchased ${p.quantity} ${p.type}  ${fmt(p.totalPrice)}`);
  });

  // ─── Phase 1: Providers list resources ───────────────────

  header("Phase 1 — Providers Listing Resources");

  const providers: Array<{
    seller: string;
    type: ResourceType;
    quantity: number;
    pricePerUnit: number;
  }> = [
    { seller: "gpu-cloud-a",  type: "compute_gpu",    quantity: 1000, pricePerUnit: 0.48  },
    { seller: "gpu-cloud-b",  type: "compute_gpu",    quantity: 500,  pricePerUnit: 0.52  },
    { seller: "cpu-pool-x",   type: "compute_cpu",    quantity: 5000, pricePerUnit: 0.045 },
    { seller: "cpu-pool-y",   type: "compute_cpu",    quantity: 3000, pricePerUnit: 0.055 },
    { seller: "api-gateway",  type: "api_credits",    quantity: 20000, pricePerUnit: 0.0018 },
    { seller: "data-lake",    type: "data_feed",      quantity: 2000, pricePerUnit: 0.09  },
    { seller: "ctx-provider", type: "context_window", quantity: 10000, pricePerUnit: 0.009 },
  ];

  for (const p of providers) {
    const listing = marketplace.listResource({
      seller:       p.seller,
      type:         p.type,
      quantity:     p.quantity,
      pricePerUnit: p.pricePerUnit,
      currency:     "USDC",
      listingType:  "spot",
    });
    log(
      "LISTED",
      `${p.seller.padEnd(14)} ${p.type.padEnd(16)} qty=${p.quantity.toString().padStart(5)}  ${fmt(p.pricePerUnit, 4)}/unit`,
    );
  }

  // ─── Phase 2: Workers spin up with budgets ────────────────

  header("Phase 2 — Worker Agents Initializing Budgets");

  const workers = [
    "analyst-agent",
    "trainer-agent",
    "scraper-agent",
    "summarizer-agent",
    "reporter-agent",
  ];

  for (const w of workers) {
    riskEngine.setBudget(w, {
      maxComputeMs: 60_000,   // 1 minute of CPU budget
      maxApiCalls:  200,
      maxSpendUsd:  2,
    });
    log("BUDGET", `${w.padEnd(18)} compute=60s  api=200  spend=$2`);
  }

  // ─── Phase 3: Multi-agent workflow ───────────────────────

  header("Phase 3 — Multi-Agent Workflow (6 rounds)");

  const workflowSteps: Array<{ agent: string; task: string; computeMin: number; apiCalls: number }> = [
    { agent: "scraper-agent",    task: "web scraping",     computeMin: 3,  apiCalls: 50  },
    { agent: "analyst-agent",    task: "data analysis",    computeMin: 5,  apiCalls: 80  },
    { agent: "trainer-agent",    task: "model fine-tune",  computeMin: 12, apiCalls: 30  },
    { agent: "summarizer-agent", task: "summarization",    computeMin: 2,  apiCalls: 100 },
    { agent: "analyst-agent",    task: "second pass",      computeMin: 8,  apiCalls: 60  },
    { agent: "reporter-agent",   task: "report generation",computeMin: 4,  apiCalls: 40  },
    { agent: "trainer-agent",    task: "model fine-tune 2",computeMin: 15, apiCalls: 25  },
    { agent: "scraper-agent",    task: "re-scrape delta",  computeMin: 6,  apiCalls: 90  },
  ];

  for (const step of workflowSteps) {
    const { agent, task, computeMin, apiCalls } = step;

    log("TASK", `${agent.padEnd(20)} → ${task}`);

    // Check compute budget
    const canCompute = riskEngine.checkBudget(agent, "compute", computeMin * 60_000);
    if (!canCompute) {
      log("LOW", `${agent} compute budget low — buying compute_cpu from market`);
      const order = marketplace.autoBuy(agent, "compute_cpu", 300);
      if (!order) {
        log("WARN", `  No compute listings available — agent ${agent} skipping step`);
        continue;
      }
    }

    // Check API budget
    const canApi = riskEngine.checkBudget(agent, "api_calls", apiCalls);
    if (!canApi) {
      log("LOW", `${agent} API budget low — buying api_credits from market`);
      const order = marketplace.buyResource({
        buyer:    agent,
        type:     "api_credits",
        quantity: 500,
        currency: "USDC",
      });
      if (!order) {
        log("WARN", `  No API credit listings available`);
      }
    }

    // Consume resources (work happens here)
    riskEngine.recordUsage(agent, "compute",   computeMin * 60_000);
    riskEngine.recordUsage(agent, "api_calls", apiCalls);

    const budget = riskEngine.getBudget(agent);
    if (budget) {
      const remainPct = Math.max(0, (budget.maxComputeMs - budget.usedComputeMs) / budget.maxComputeMs * 100);
      log(
        "USE",
        `  compute ${(computeMin).toString().padStart(2)}min  api ${apiCalls.toString().padStart(3)} calls  ` +
        `(budget remaining: ${remainPct.toFixed(0)}%)`,
      );
    }

    await sleep(10); // tiny pause for realism
  }

  // ─── Phase 4: A worker also sells unused credits ─────────

  header("Phase 4 — Worker Sells Unused Resources Back");

  // analyst-agent has some remaining context_window budget, lists it
  const resell = marketplace.listResource({
    seller:       "analyst-agent",
    type:         "context_window",
    quantity:     500,
    pricePerUnit: 0.0095, // slightly above current market
    currency:     "USDC",
    listingType:  "spot",
  });
  log("LISTED", `analyst-agent listed 500 context_window credits at ${fmt(0.0095, 4)}/unit`);

  // Another agent buys them
  const crossBuy = marketplace.buyResource({
    buyer:    "reporter-agent",
    type:     "context_window",
    quantity: 300,
    currency: "USDC",
  });
  if (crossBuy) {
    log(
      "FILLED",
      `reporter-agent bought 300 context_window from analyst-agent  ${fmt(crossBuy.totalPrice)}`,
    );
  }

  // ─── Phase 5: High demand — price spike ───────────────────

  header("Phase 5 — Demand Surge Drives Price Up");

  // Multiple agents buy GPU compute heavily
  const surgeAgents = ["surge-a", "surge-b", "surge-c"];
  for (const a of surgeAgents) {
    const order = marketplace.buyResource({
      buyer:    a,
      type:     "compute_gpu",
      quantity: 250,
      currency: "USDC",
    });
    if (order) {
      log("SURGE", `${a} bought 250 gpu-min  ${fmt(order.totalPrice)}`);
    }
  }

  // ─── Phase 6: Final Market Summary ───────────────────────

  header("Phase 6 — Market Summary");

  const stats = marketplace.stats();

  // Current prices vs base
  console.log("Resource Prices (current vs base):\n");
  console.log(
    "  " +
    "Resource".padEnd(18) +
    "Base".padEnd(12) +
    "Current".padEnd(12) +
    "Change".padEnd(10) +
    "Util".padEnd(8) +
    "Available",
  );
  console.log("  " + "─".repeat(70));
  for (const [type, info] of Object.entries(stats.prices)) {
    const pct = ((info.current - info.base) / info.base * 100).toFixed(1);
    const sign = info.current >= info.base ? "+" : "";
    console.log(
      "  " +
      type.padEnd(18) +
      fmt(info.base, 4).padEnd(12) +
      fmt(info.current, 4).padEnd(12) +
      `${sign}${pct}%`.padEnd(10) +
      `${(info.utilization * 100).toFixed(0)}%`.padEnd(8) +
      info.activeListings.toLocaleString(),
    );
  }

  console.log("\nTop Sellers:\n");
  for (const [i, seller] of stats.topSellers.entries()) {
    console.log(
      `  ${(i + 1).toString().padEnd(3)} ${seller.seller.padEnd(20)} ${seller.orders.toString().padStart(3)} orders  ${fmt(seller.volume, 4)} gross volume`,
    );
  }

  console.log("\nMarket Totals:\n");
  console.log(`  Total orders:       ${stats.totalOrders}`);
  console.log(`  Total volume:       ${fmt(stats.totalVolume, 4)}`);
  console.log(`  Platform revenue:   ${fmt(stats.platformRevenue, 4)} (5% spread)`);
  console.log(`  Active listings:    ${stats.activeListings}`);

  console.log("\nRecent Orders (last 5):\n");
  for (const o of stats.recentOrders.slice(0, 5)) {
    console.log(
      `  ${o.resourceType.padEnd(18)} qty=${o.quantity.toString().padStart(5)}  ` +
      `buyer=${o.buyer.padEnd(20)} total=${fmt(o.totalPrice, 4)}  fee=${fmt(o.platformFee, 4)}`,
    );
  }

  // Billing stats
  const billingStats = billing.stats();
  console.log(`\nBilling engine:`);
  console.log(`  Usage records:      ${billingStats.totalRecords}`);
  console.log(`  Total revenue:      ${fmt(billingStats.totalRevenue, 4)}`);

  header("Demo Complete");

  // Cleanup
  marketplace.stop();
  riskEngine.stop();
  billing.stop();
  await bus.disconnect();

  process.exit(0);
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
