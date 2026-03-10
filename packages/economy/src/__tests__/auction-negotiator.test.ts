import { describe, expect, it } from "vitest";
import type { AgentIdentity } from "@clawdia/types";
import { AuctionNegotiator } from "../marketplace/auction-negotiator.js";

function agent(
  name: string,
  amount: number,
  availability = 0.99,
): AgentIdentity {
  return {
    name,
    displayName: name,
    description: name,
    version: "1.0.0",
    operator: `${name}-operator`,
    publicKey: name,
    capabilities: [
      {
        taxonomy: "code.write.typescript",
        description: "Write TypeScript",
        inputSchema: {},
        outputSchema: {},
        sla: { maxLatencyMs: 1000, availability },
        pricing: { model: "per_request", amount, currency: "USDC" },
      },
    ],
    requirements: [],
    runtime: {},
  };
}

describe("AuctionNegotiator", () => {
  it("selects the best bid based on price and availability", () => {
    const negotiator = new AuctionNegotiator();
    const auction = negotiator.createAuction({
      capability: "code.write.typescript",
      requester: "buyer",
      maxBudget: 10,
      currency: "USDC",
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    });

    negotiator.placeBid(auction.id, { agent: agent("fast", 8, 0.99), amount: 8, currency: "USDC" });
    negotiator.placeBid(auction.id, { agent: agent("cheap", 6, 0.95), amount: 6, currency: "USDC" });

    const result = negotiator.closeAuction(auction.id);
    expect(result.winningBid?.agentName).toBe("cheap");
    expect(result.bids).toHaveLength(2);
  });

  it("rejects bids over budget", () => {
    const negotiator = new AuctionNegotiator();
    const auction = negotiator.createAuction({
      capability: "code.write.typescript",
      requester: "buyer",
      maxBudget: 5,
      currency: "USDC",
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(() =>
      negotiator.placeBid(auction.id, {
        agent: agent("expensive", 8),
        amount: 8,
        currency: "USDC",
      }),
    ).toThrow("Bid exceeds auction budget");
  });
});
