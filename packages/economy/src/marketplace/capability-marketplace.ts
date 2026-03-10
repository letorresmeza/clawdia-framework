import type { CapabilityOffer } from "@clawdia/types";

interface RegistryLike {
  discover(query: {
    taxonomy?: string;
    operator?: string;
    currency?: string;
    minReputation?: number;
    onlineOnly?: boolean;
  }): {
    entries: Array<{
      identity: {
        name: string;
        operator: string;
        reputation?: { score: number };
        capabilities: Array<{
          taxonomy: string;
          description: string;
          pricing: { model: string; amount: number; currency: string };
          sla: { availability: number; maxLatencyMs: number };
        }>;
      };
    }>;
    total: number;
  };
}

export interface CapabilitySearchQuery {
  taxonomy?: string;
  operator?: string;
  currency?: string;
  pricingModel?: string;
  minReputation?: number;
  limit?: number;
}

export class CapabilityMarketplace {
  constructor(private readonly registry: RegistryLike) {}

  search(query: CapabilitySearchQuery = {}): CapabilityOffer[] {
    const { entries } = this.registry.discover({
      taxonomy: query.taxonomy,
      operator: query.operator,
      currency: query.currency,
      minReputation: query.minReputation,
      onlineOnly: false,
    });

    const offers = entries.flatMap((entry) =>
      entry.identity.capabilities
        .filter((capability) => {
          if (query.taxonomy && query.taxonomy.endsWith("*")) {
            return capability.taxonomy.startsWith(query.taxonomy.slice(0, -1));
          }
          if (query.taxonomy && capability.taxonomy !== query.taxonomy) {
            return false;
          }
          if (query.currency && capability.pricing.currency !== query.currency) {
            return false;
          }
          if (query.pricingModel && capability.pricing.model !== query.pricingModel) {
            return false;
          }
          return true;
        })
        .map<CapabilityOffer>((capability) => ({
          agentName: entry.identity.name,
          operator: entry.identity.operator,
          capability: capability.taxonomy,
          description: capability.description,
          priceModel: capability.pricing.model,
          priceAmount: capability.pricing.amount,
          currency: capability.pricing.currency,
          availability: capability.sla.availability,
          maxLatencyMs: capability.sla.maxLatencyMs,
          reputationScore: entry.identity.reputation?.score,
        })),
    );

    offers.sort((a, b) => {
      if ((b.reputationScore ?? 0) !== (a.reputationScore ?? 0)) {
        return (b.reputationScore ?? 0) - (a.reputationScore ?? 0);
      }
      if (a.priceAmount !== b.priceAmount) {
        return a.priceAmount - b.priceAmount;
      }
      return b.availability - a.availability;
    });

    return query.limit ? offers.slice(0, query.limit) : offers;
  }

  topCapabilities(limit = 10): Array<{ capability: string; offers: number; operators: number }> {
    const aggregates = new Map<string, { offers: number; operators: Set<string> }>();
    for (const offer of this.search()) {
      const current = aggregates.get(offer.capability) ?? { offers: 0, operators: new Set<string>() };
      current.offers++;
      current.operators.add(offer.operator);
      aggregates.set(offer.capability, current);
    }

    return Array.from(aggregates.entries())
      .map(([capability, stats]) => ({
        capability,
        offers: stats.offers,
        operators: stats.operators.size,
      }))
      .sort((a, b) => b.offers - a.offers)
      .slice(0, limit);
  }
}
