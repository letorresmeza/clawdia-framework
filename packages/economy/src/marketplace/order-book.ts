import { v7 as uuid } from "uuid";
import type { ResourceListing, ResourceOrder, ResourceType } from "@clawdia/types";

// ─────────────────────────────────────────────────────────
// Parameter types
// ─────────────────────────────────────────────────────────

export interface ListResourceParams {
  seller: string;
  type: ResourceType;
  quantity: number;
  pricePerUnit: number;
  unit: string;
  currency: string;
  listingType: "spot" | "reserved";
  minCommitmentHours?: number;
  expiresAt?: string;
}

export interface PlaceOrderParams {
  buyer: string;
  type: ResourceType;
  quantity: number;
  /** Maximum price buyer is willing to pay per unit (exclusive of spread) */
  maxPricePerUnit?: number;
  currency: string;
}

export interface OrderFill {
  order: ResourceOrder;
  /** Snapshot of the listing that was filled */
  listing: ResourceListing;
  /** Raw unit price from the listing (before spread) */
  rawUnitPrice: number;
  quantityFilled: number;
}

// ─────────────────────────────────────────────────────────
// OrderBook
// ─────────────────────────────────────────────────────────

/**
 * Pure order-book: manages listings and matches buyers against sellers.
 * No billing or pricing logic here — the Marketplace layer handles those.
 */
export class OrderBook {
  private listings = new Map<string, ResourceListing>();
  private orders = new Map<string, ResourceOrder>();

  // Per-seller stats
  private sellerVolumes = new Map<string, number>();
  private sellerOrderCounts = new Map<string, number>();

  // ─── Seller operations ─────────────────────────────────

  listResource(params: ListResourceParams): ResourceListing {
    const listing: ResourceListing = {
      id: uuid(),
      seller: params.seller,
      type: params.type,
      quantity: params.quantity,
      unit: params.unit,
      pricePerUnit: params.pricePerUnit,
      currency: params.currency,
      listingType: params.listingType,
      minCommitmentHours: params.minCommitmentHours,
      expiresAt: params.expiresAt,
    };
    this.listings.set(listing.id, listing);
    return { ...listing };
  }

  /** Remove a listing. Returns true if removed. */
  cancelListing(listingId: string, seller: string): boolean {
    const listing = this.listings.get(listingId);
    if (!listing || listing.seller !== seller) return false;
    this.listings.delete(listingId);
    return true;
  }

  // ─── Buyer operations ──────────────────────────────────

  /**
   * Return the cheapest listing that would match a buy request, without consuming it.
   * Used by the marketplace to compute spread-adjusted prices before committing.
   */
  peekBestListing(
    type: ResourceType,
    currency: string,
    maxRawPrice?: number,
  ): ResourceListing | null {
    const now = new Date();
    const candidates = Array.from(this.listings.values())
      .filter(
        (l) =>
          l.type === type &&
          l.currency === currency &&
          l.quantity > 0 &&
          (maxRawPrice === undefined || l.pricePerUnit <= maxRawPrice) &&
          (l.expiresAt === undefined || new Date(l.expiresAt) > now),
      )
      .sort((a, b) => a.pricePerUnit - b.pricePerUnit);
    return candidates[0] ? { ...candidates[0] } : null;
  }

  /**
   * Match a buy request against available listings.
   * Selects the lowest-priced listing that meets constraints.
   * Returns null if nothing matches.
   *
   * The caller is responsible for applying the platform spread to the
   * `pricePerUnit` before presenting it to the buyer.
   */
  matchOrder(
    params: PlaceOrderParams,
    /**
     * The price the buyer will actually pay per unit (after spread).
     * Provided by the Marketplace so we can store the final buyer price
     * in the order record.
     */
    buyerPricePerUnit: number,
    platformFee: number,
  ): OrderFill | null {
    const now = new Date();

    // Find eligible listings: correct type, currency, enough capacity, price fits
    const candidates = Array.from(this.listings.values())
      .filter(
        (l) =>
          l.type === params.type &&
          l.currency === params.currency &&
          l.quantity > 0 &&
          (params.maxPricePerUnit === undefined ||
            l.pricePerUnit <= params.maxPricePerUnit) &&
          (l.expiresAt === undefined || new Date(l.expiresAt) > now),
      )
      .sort((a, b) => a.pricePerUnit - b.pricePerUnit); // lowest price first

    if (candidates.length === 0) return null;

    const best = candidates[0]!;
    const quantityFilled = Math.min(params.quantity, best.quantity);

    // Deduct from listing
    best.quantity -= quantityFilled;
    if (best.quantity === 0) {
      this.listings.delete(best.id);
    }

    // Track seller stats (at raw listing price)
    const sellerRevenue = quantityFilled * best.pricePerUnit;
    this.sellerVolumes.set(
      best.seller,
      (this.sellerVolumes.get(best.seller) ?? 0) + sellerRevenue,
    );
    this.sellerOrderCounts.set(
      best.seller,
      (this.sellerOrderCounts.get(best.seller) ?? 0) + 1,
    );

    const now2 = new Date().toISOString();
    const order: ResourceOrder = {
      id: uuid(),
      buyer: params.buyer,
      listingId: best.id,
      resourceType: params.type,
      quantity: quantityFilled,
      pricePerUnit: buyerPricePerUnit,
      totalPrice: quantityFilled * buyerPricePerUnit,
      platformFee,
      currency: params.currency,
      status: "filled",
      createdAt: now2,
      filledAt: now2,
    };

    this.orders.set(order.id, order);

    return {
      order,
      listing: { ...best, quantity: best.quantity + quantityFilled }, // snapshot pre-fill
      rawUnitPrice: best.pricePerUnit,
      quantityFilled,
    };
  }

  // ─── Query ─────────────────────────────────────────────

  getListing(id: string): ResourceListing | undefined {
    const l = this.listings.get(id);
    return l ? { ...l } : undefined;
  }

  getOrder(id: string): ResourceOrder | undefined {
    const o = this.orders.get(id);
    return o ? { ...o } : undefined;
  }

  getListingsByType(type: ResourceType): ResourceListing[] {
    return Array.from(this.listings.values())
      .filter((l) => l.type === type)
      .map((l) => ({ ...l }));
  }

  listListings(): ResourceListing[] {
    return Array.from(this.listings.values()).map((l) => ({ ...l }));
  }

  listOrders(limit?: number): ResourceOrder[] {
    const all = Array.from(this.orders.values()).map((o) => ({ ...o }));
    // Most recent first
    all.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    return limit !== undefined ? all.slice(0, limit) : all;
  }

  /** Total active capacity (sum of quantities) for a resource type */
  activeCapacity(type: ResourceType): number {
    return Array.from(this.listings.values())
      .filter((l) => l.type === type)
      .reduce((sum, l) => sum + l.quantity, 0);
  }

  /** Total quantity filled for a resource type */
  filledVolume(type: ResourceType): number {
    return Array.from(this.orders.values())
      .filter((o) => o.resourceType === type && o.status === "filled")
      .reduce((sum, o) => sum + o.quantity, 0);
  }

  /** Top sellers sorted by gross volume (listing price × quantity) */
  topSellers(limit = 5): Array<{ seller: string; volume: number; orders: number }> {
    return Array.from(this.sellerVolumes.keys())
      .map((seller) => ({
        seller,
        volume: this.sellerVolumes.get(seller) ?? 0,
        orders: this.sellerOrderCounts.get(seller) ?? 0,
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, limit);
  }

  /** Summary stats */
  stats(): { totalListings: number; totalOrders: number; totalVolume: number } {
    const totalVolume = Array.from(this.orders.values()).reduce(
      (sum, o) => sum + o.totalPrice,
      0,
    );
    return {
      totalListings: this.listings.size,
      totalOrders: this.orders.size,
      totalVolume,
    };
  }
}
