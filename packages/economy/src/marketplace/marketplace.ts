import type {
  ResourceListing,
  ResourceOrder,
  ResourceType,
  MarketplaceStats,
  AgentIdentity,
  ClawMessage,
} from "@clawdia/types";
import type { IClawBus } from "@clawdia/core";
import type { RiskEngine } from "@clawdia/core";
import { OrderBook, type ListResourceParams, type PlaceOrderParams } from "./order-book.js";
import { PricingEngine, type PricingConfig, RESOURCE_UNITS } from "./pricing-engine.js";
import type { BillingEngine } from "../billing/billing-engine.js";

// ─────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────

export interface MarketplaceConfig extends Partial<PricingConfig> {
  /**
   * Platform spread taken from every transaction.
   * Buyers pay listingPrice × (1 + spreadPercent/100).
   * Sellers receive listingPrice; platform keeps the spread.
   * Default: 5
   */
  spreadPercent: number;
  /**
   * When an agent's budget fraction drops below this threshold,
   * the marketplace will attempt to auto-buy resources on their behalf.
   * Default: 0.20 (20 % of max remaining triggers auto-buy)
   */
  autoBuyThreshold: number;
  /** Default quantity to auto-buy when budget is low. Default: 100 */
  autoBuyQuantity: number;
}

const DEFAULT_CONFIG: MarketplaceConfig = {
  spreadPercent:    5,
  autoBuyThreshold: 0.20,
  autoBuyQuantity:  100,
};

// ─────────────────────────────────────────────────────────
// Internal identity for bus publishing
// ─────────────────────────────────────────────────────────

const MARKETPLACE_ID: AgentIdentity = {
  name:        "marketplace",
  displayName: "Resource Marketplace",
  description: "Clawdia resource marketplace engine",
  version:     "1.0.0",
  operator:    "system",
  publicKey:   "system",
  capabilities:  [],
  requirements:  [],
  runtime:       {},
};

// ─────────────────────────────────────────────────────────
// ResourceMarketplace
// ─────────────────────────────────────────────────────────

/**
 * Central marketplace for agent resource trading.
 *
 * - Sellers create listings (compute, API credits, data feeds, etc.)
 * - Buyers place orders matched against cheapest available listing
 * - Platform takes a configurable spread on every trade
 * - Dynamic pricing adjusts based on supply/demand utilization
 * - Integrates with BillingEngine for revenue tracking
 * - Optionally integrates with RiskEngine for agent budget top-ups
 */
export class ResourceMarketplace {
  private orderBook: OrderBook;
  private pricing:   PricingEngine;
  private config:    MarketplaceConfig;
  private subscriptionIds: string[] = [];
  private platformRevenue = 0;
  private running = false;

  constructor(
    private bus:         IClawBus,
    private billing:     BillingEngine,
    private riskEngine?: RiskEngine,
    config?: Partial<MarketplaceConfig>,
  ) {
    this.config    = { ...DEFAULT_CONFIG, ...config };
    this.orderBook = new OrderBook();

    // Build PricingConfig from only the defined fields in config (avoid undefined overwriting defaults)
    const pricingConfig: Partial<PricingConfig> = {};
    if (config?.highUtilizationThreshold !== undefined) pricingConfig.highUtilizationThreshold = config.highUtilizationThreshold;
    if (config?.lowUtilizationThreshold  !== undefined) pricingConfig.lowUtilizationThreshold  = config.lowUtilizationThreshold;
    if (config?.priceIncreaseRate        !== undefined) pricingConfig.priceIncreaseRate        = config.priceIncreaseRate;
    if (config?.priceDecreaseRate        !== undefined) pricingConfig.priceDecreaseRate        = config.priceDecreaseRate;
    if (config?.minPriceMultiplier       !== undefined) pricingConfig.minPriceMultiplier       = config.minPriceMultiplier;
    if (config?.maxPriceMultiplier       !== undefined) pricingConfig.maxPriceMultiplier       = config.maxPriceMultiplier;
    this.pricing = new PricingEngine(pricingConfig);
  }

  // ─── Lifecycle ─────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    // Auto-buy when a budget is exceeded
    this.subscriptionIds.push(
      this.bus.subscribe("risk.budget.exceeded", this._onBudgetExceeded.bind(this)),
    );
  }

  stop(): void {
    for (const id of this.subscriptionIds) {
      this.bus.unsubscribe(id);
    }
    this.subscriptionIds = [];
    this.running = false;
  }

  // ─── Seller operations ─────────────────────────────────

  /**
   * Create a resource listing on the order book.
   * Caller can omit pricePerUnit to use the current dynamic spot price.
   */
  listResource(
    params: Omit<ListResourceParams, "pricePerUnit" | "unit"> & { pricePerUnit?: number; unit?: string },
  ): ResourceListing {
    const price  = params.pricePerUnit ?? this.pricing.getPrice(params.type);
    const unit   = params.unit ?? RESOURCE_UNITS[params.type] ?? "unit";
    const listing = this.orderBook.listResource({ ...params, unit, pricePerUnit: price });

    this.pricing.recordListing(params.type, params.quantity);

    void this.bus.publish(
      "marketplace.listed",
      {
        listingId: listing.id,
        seller:    listing.seller,
        type:      listing.type,
        quantity:  listing.quantity,
        price,
      },
      MARKETPLACE_ID,
    );

    return listing;
  }

  /** Remove a listing before it is filled */
  cancelListing(listingId: string, seller: string): boolean {
    const listing = this.orderBook.getListing(listingId);
    const removed = this.orderBook.cancelListing(listingId, seller);
    if (removed && listing) {
      this.pricing.recordCancellation(listing.type, listing.quantity);
    }
    return removed;
  }

  // ─── Buyer operations ──────────────────────────────────

  /**
   * Buy resources from the market.
   *
   * Matches against the cheapest available listing.
   * Buyer pays `rawPrice × (1 + spreadPercent/100)`.
   * Seller receives `rawPrice × quantity`; platform keeps the spread.
   *
   * After a successful fill, the buyer's RiskEngine budget is extended
   * (if riskEngine is connected).
   *
   * Returns null when no matching listing is available.
   */
  buyResource(params: PlaceOrderParams): ResourceOrder | null {
    const spread = this.config.spreadPercent / 100;

    // Phase 1: peek at the cheapest matching listing to get the raw price,
    // so we can compute spread-adjusted buyer price before consuming the listing.
    const bestListing = this.orderBook.peekBestListing(
      params.type,
      params.currency,
      params.maxPricePerUnit,
    );
    if (!bestListing) return null;

    const rawPrice           = bestListing.pricePerUnit;
    const buyerPrice         = rawPrice * (1 + spread);
    const platformFeePerUnit = rawPrice * spread;

    // Phase 2: execute the match with final prices already computed.
    // Pass a pre-estimated platformFee; we'll correct it after if partially filled.
    const estimatedQty = Math.min(params.quantity, bestListing.quantity);
    const fill = this.orderBook.matchOrder(
      params,
      buyerPrice,
      platformFeePerUnit * estimatedQty,
    );
    if (!fill) return null;

    // Correct platformFee for the actual quantity filled (may differ from estimate)
    const platformFee       = platformFeePerUnit * fill.quantityFilled;
    fill.order.platformFee  = platformFee;
    fill.order.totalPrice   = fill.quantityFilled * buyerPrice;

    const { order, quantityFilled } = fill;

    // ── Pricing: record fill ─────────────────────────────
    this.pricing.recordFill(params.type, quantityFilled);

    // ── Revenue tracking ─────────────────────────────────
    this.platformRevenue += platformFee;

    // ── Billing ──────────────────────────────────────────
    // Record the buyer's spend
    this.billing.recordUsage({
      agentName:    params.buyer,
      resourceType: `marketplace.${params.type}`,
      quantity:     quantityFilled,
      unit:         RESOURCE_UNITS[params.type] ?? "unit",
      cost:         order.totalPrice,
      currency:     params.currency,
      metadata: {
        listingId:   fill.listing.id,
        seller:      fill.listing.seller,
        rawPrice:    String(rawPrice),
        buyerPrice:  String(buyerPrice),
        platformFee: String(platformFee),
      },
    });

    // Record platform revenue in billing
    this.billing.recordUsage({
      agentName:    "platform",
      resourceType: "marketplace.spread",
      quantity:     1,
      unit:         "trade",
      cost:         platformFee,
      currency:     params.currency,
      metadata: {
        resourceType: params.type,
        buyer:        params.buyer,
        seller:       fill.listing.seller,
      },
    });

    // ── Budget top-up ─────────────────────────────────────
    if (this.riskEngine) {
      this._topUpBudget(params.buyer, params.type, quantityFilled);
    }

    // ── Bus event ─────────────────────────────────────────
    void this.bus.publish(
      "marketplace.filled",
      {
        orderId:      order.id,
        buyer:        params.buyer,
        seller:       fill.listing.seller,
        type:         params.type,
        quantity:     quantityFilled,
        rawPrice,
        buyerPrice,
        platformFee,
        currency:     params.currency,
      },
      MARKETPLACE_ID,
    );

    // Notify if price changed materially (>1% from base)
    this._maybeBroadcastPriceChange(params.type);

    return order;
  }

  /**
   * Automatically buy compute or API credits for an agent whose budget is low.
   * Called internally on `risk.budget.exceeded` events, but also callable directly.
   *
   * Returns the filled order, or null if nothing was available.
   */
  autoBuy(
    agentName: string,
    type: ResourceType,
    quantity = this.config.autoBuyQuantity,
  ): ResourceOrder | null {
    const order = this.buyResource({
      buyer:    agentName,
      type,
      quantity,
      currency: "USDC",
    });

    if (order) {
      void this.bus.publish(
        "marketplace.auto.buy",
        {
          agentName,
          type,
          quantity: order.quantity,
          totalPrice: order.totalPrice,
        },
        MARKETPLACE_ID,
      );
    }

    return order;
  }

  // ─── Price queries ─────────────────────────────────────

  getPrice(type: ResourceType): number {
    return this.pricing.getPrice(type);
  }

  allPrices(): Record<string, { current: number; base: number; utilization: number; activeListings: number }> {
    return this.pricing.allPrices();
  }

  // ─── Stats ─────────────────────────────────────────────

  stats(): MarketplaceStats {
    const bookStats = this.orderBook.stats();
    return {
      prices:          this.pricing.allPrices(),
      recentOrders:    this.orderBook.listOrders(20),
      topSellers:      this.orderBook.topSellers(10),
      totalVolume:     bookStats.totalVolume,
      platformRevenue: this.platformRevenue,
      activeListings:  bookStats.totalListings,
      totalOrders:     bookStats.totalOrders,
    };
  }

  // ─── Direct access (for testing) ───────────────────────

  getListing(id: string): ResourceListing | undefined {
    return this.orderBook.getListing(id);
  }

  getOrder(id: string): ResourceOrder | undefined {
    return this.orderBook.getOrder(id);
  }

  listListings(): ResourceListing[] {
    return this.orderBook.listListings();
  }

  listOrders(): ResourceOrder[] {
    return this.orderBook.listOrders();
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ─── Private helpers ───────────────────────────────────

  /**
   * Extend an agent's risk budget after a marketplace purchase.
   * Maps marketplace resource types to RiskEngine budget dimensions.
   */
  private _topUpBudget(agentName: string, type: ResourceType, quantity: number): void {
    if (!this.riskEngine) return;
    const current = this.riskEngine.getBudget(agentName);
    if (!current) return;

    // Determine what budget dimension to extend
    let newBudget: Parameters<RiskEngine["setBudget"]>[1];
    const ONE_MIN_MS = 60_000;

    switch (type) {
      case "compute_gpu":
      case "compute_cpu":
        // 1 unit = 1 CPU/GPU-minute = 60,000 ms
        newBudget = {
          maxComputeMs: current.maxComputeMs + quantity * ONE_MIN_MS,
          maxApiCalls:  current.maxApiCalls,
          maxSpendUsd:  current.maxSpendUsd,
        };
        break;
      case "api_credits":
        // 1 unit = 1 API call
        newBudget = {
          maxComputeMs: current.maxComputeMs,
          maxApiCalls:  current.maxApiCalls + quantity,
          maxSpendUsd:  current.maxSpendUsd,
        };
        break;
      default:
        // data_feed, context_window, memory → extend spend budget
        // 1 unit ≈ 1 USDC of spend capacity (rough proxy)
        newBudget = {
          maxComputeMs: current.maxComputeMs,
          maxApiCalls:  current.maxApiCalls,
          maxSpendUsd:  current.maxSpendUsd + quantity,
        };
    }

    this.riskEngine.setBudget(agentName, newBudget);

    // Re-apply existing usage since setBudget resets counters
    this.riskEngine.recordUsage(agentName, "compute",   current.usedComputeMs);
    this.riskEngine.recordUsage(agentName, "api_calls", current.usedApiCalls);
    this.riskEngine.recordUsage(agentName, "spend",     current.usedSpendUsd);
  }

  /** Broadcast a price-changed event if the current price differs from base by >1% */
  private _maybeBroadcastPriceChange(type: ResourceType): void {
    const info = this.pricing.allPrices()[type];
    if (!info) return;
    const pctChange = Math.abs(info.current - info.base) / info.base;
    if (pctChange >= 0.01) {
      void this.bus.publish(
        "marketplace.price.changed",
        { type, current: info.current, base: info.base, utilization: info.utilization },
        MARKETPLACE_ID,
      );
    }
  }

  /** Handle `risk.budget.exceeded` — auto-buy relevant resources */
  private async _onBudgetExceeded(msg: ClawMessage): Promise<void> {
    const payload = msg.payload as {
      type?: string;
      agent?: string;
      details?: Record<string, unknown>;
    };

    const agentName = payload.agent ?? msg.sender.name;
    const details = payload.details ?? {};

    // Determine which resource type is exhausted
    const computeStr = details["compute"] as string | undefined;
    const apiStr     = details["apiCalls"] as string | undefined;

    if (computeStr) {
      // Try to auto-buy compute credits
      const bought = this.autoBuy(agentName, "compute_cpu");
      if (!bought) {
        this.autoBuy(agentName, "compute_gpu");
      }
    }

    if (apiStr) {
      this.autoBuy(agentName, "api_credits");
    }
  }
}
