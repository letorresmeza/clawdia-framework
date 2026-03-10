import { beforeEach, describe, expect, it } from "vitest";
import type { AgentIdentity } from "@clawdia/types";
import { CapabilityMarketplace } from "../marketplace/capability-marketplace.js";

function identity(
  name: string,
  operator: string,
  model: AgentIdentity["capabilities"][number]["pricing"]["model"] = "per_request",
): AgentIdentity {
  return {
    name,
    displayName: name,
    description: name,
    version: "1.0.0",
    operator,
    publicKey: name,
    capabilities: [
      {
        taxonomy: "analysis.market.sentiment",
        description: "Analyze market sentiment",
        inputSchema: {},
        outputSchema: {},
        sla: { maxLatencyMs: 1000, availability: 0.99 },
        pricing: { model, amount: model === "subscription" ? 50 : 1, currency: "USDC" },
      },
    ],
    requirements: [],
    runtime: {},
  };
}

describe("CapabilityMarketplace", () => {
  let registry: {
    discover: (query?: {
      taxonomy?: string;
      operator?: string;
      currency?: string;
      minReputation?: number;
      onlineOnly?: boolean;
    }) => { entries: Array<{ identity: AgentIdentity; status: "online" }>; total: number };
  };
  let marketplace: CapabilityMarketplace;

  beforeEach(async () => {
    const alpha = identity("alpha-agent", "alpha");
    alpha.reputation = {
      registry: "test",
      score: 0.9,
      minimumStake: 0,
      dimensions: { reliability: 0.9, quality: 0.9, speed: 0.9, costEfficiency: 0.9 },
      attestations: [],
    };
    const entries = [
      { identity: alpha, status: "online" as const },
      { identity: identity("beta-agent", "beta", "subscription"), status: "online" as const },
    ];
    registry = {
      discover: (query = {}) => {
        const filtered = entries.filter((entry) => {
          if (query.operator && entry.identity.operator !== query.operator) return false;
          if (
            query.minReputation !== undefined &&
            (entry.identity.reputation?.score ?? 0) < query.minReputation
          ) {
            return false;
          }
          if (query.currency) {
            return entry.identity.capabilities.some((cap) => cap.pricing.currency === query.currency);
          }
          if (query.taxonomy) {
            return entry.identity.capabilities.some((cap) =>
              query.taxonomy?.endsWith("*")
                ? cap.taxonomy.startsWith(query.taxonomy.slice(0, -1))
                : cap.taxonomy === query.taxonomy,
            );
          }
          return true;
        });
        return { entries: filtered, total: filtered.length };
      },
    };
    marketplace = new CapabilityMarketplace(registry as never);
  });

  it("searches capability offers across operators", () => {
    const offers = marketplace.search({ taxonomy: "analysis.market.*" });
    expect(offers).toHaveLength(2);
    expect(offers[0]?.agentName).toBe("alpha-agent");
  });

  it("filters by operator and pricing model", () => {
    const offers = marketplace.search({ operator: "beta", pricingModel: "subscription" });
    expect(offers).toHaveLength(1);
    expect(offers[0]?.operator).toBe("beta");
    expect(offers[0]?.priceModel).toBe("subscription");
  });

  it("aggregates top capabilities", () => {
    const top = marketplace.topCapabilities(1);
    expect(top[0]).toEqual({
      capability: "analysis.market.sentiment",
      offers: 2,
      operators: 2,
    });
  });
});
