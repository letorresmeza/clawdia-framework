import { v7 as uuid } from "uuid";
import type {
  CapabilityAuctionBid,
  CapabilityAuctionRequest,
  CapabilityAuctionResult,
} from "@clawdia/types";
import type { AgentIdentity } from "@clawdia/types";

export interface AuctionBidInput {
  agent: AgentIdentity;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export class AuctionNegotiator {
  private auctions = new Map<string, CapabilityAuctionRequest>();
  private bids = new Map<string, CapabilityAuctionBid[]>();

  createAuction(
    request: Omit<CapabilityAuctionRequest, "id"> & { id?: string },
  ): CapabilityAuctionRequest {
    const auction: CapabilityAuctionRequest = {
      ...request,
      id: request.id ?? uuid(),
    };
    this.auctions.set(auction.id, auction);
    this.bids.set(auction.id, []);
    return { ...auction };
  }

  placeBid(auctionId: string, input: AuctionBidInput): CapabilityAuctionBid {
    const auction = this.auctions.get(auctionId);
    if (!auction) {
      throw new Error(`Auction "${auctionId}" not found`);
    }
    if (input.amount > auction.maxBudget) {
      throw new Error(`Bid exceeds auction budget of ${auction.maxBudget} ${auction.currency}`);
    }

    const capability = input.agent.capabilities.find((cap) => cap.taxonomy === auction.capability);
    if (!capability) {
      throw new Error(
        `Agent "${input.agent.name}" does not provide capability "${auction.capability}"`,
      );
    }

    const bid: CapabilityAuctionBid = {
      id: uuid(),
      auctionId,
      agentName: input.agent.name,
      operator: input.agent.operator,
      amount: input.amount,
      currency: input.currency,
      availability: capability.sla.availability,
      maxLatencyMs: capability.sla.maxLatencyMs,
      score: this.scoreBid(input.amount, auction.maxBudget, capability.sla.availability),
      submittedAt: new Date().toISOString(),
      metadata: input.metadata,
    };

    this.bids.get(auctionId)!.push(bid);
    return { ...bid };
  }

  listBids(auctionId: string): CapabilityAuctionBid[] {
    return (this.bids.get(auctionId) ?? []).map((bid) => ({ ...bid }));
  }

  closeAuction(auctionId: string): CapabilityAuctionResult {
    const auction = this.auctions.get(auctionId);
    if (!auction) {
      throw new Error(`Auction "${auctionId}" not found`);
    }

    const bids = this.listBids(auctionId).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.amount !== b.amount) return a.amount - b.amount;
      return b.availability - a.availability;
    });

    return {
      auction: { ...auction },
      winningBid: bids[0] ?? null,
      bids,
      closedAt: new Date().toISOString(),
    };
  }

  private scoreBid(amount: number, maxBudget: number, availability: number): number {
    const priceScore = maxBudget === 0 ? 0 : 1 - amount / maxBudget;
    return priceScore * 0.7 + availability * 0.3;
  }
}
