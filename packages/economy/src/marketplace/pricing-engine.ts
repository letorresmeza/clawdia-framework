import type { ResourceType, ResourcePriceInfo } from "@clawdia/types";

// ─────────────────────────────────────────────────────────
// Base prices (USDC per unit)
// ─────────────────────────────────────────────────────────

/** Default base prices per resource type. One unit = 1 of the natural unit. */
export const BASE_PRICES: Record<ResourceType, number> = {
  compute_gpu:    0.50,  // per GPU-minute
  compute_cpu:    0.05,  // per CPU-minute
  api_credits:    0.002, // per API call
  data_feed:      0.10,  // per MB
  context_window: 0.01,  // per 1 K tokens
  memory:         0.01,  // per GB-hour (not in ResourceType but guarded)
};

/** Natural units for display */
export const RESOURCE_UNITS: Record<ResourceType, string> = {
  compute_gpu:    "gpu-min",
  compute_cpu:    "cpu-min",
  api_credits:    "credit",
  data_feed:      "MB",
  context_window: "1K-tokens",
  memory:         "GB-hr",
};

// ─────────────────────────────────────────────────────────
// Per-resource metrics
// ─────────────────────────────────────────────────────────

interface ResourceMetrics {
  /** Base price at initialisation */
  basePrice: number;
  /** Current dynamic price */
  currentPrice: number;
  /** Total quantity ever listed (cumulative) */
  totalListed: number;
  /** Total quantity ever filled (cumulative) */
  totalFilled: number;
  /** Currently active (unlisted-but-available) capacity */
  activeCapacity: number;
}

// ─────────────────────────────────────────────────────────
// PricingConfig
// ─────────────────────────────────────────────────────────

export interface PricingConfig {
  /** Utilization above which prices rise. Default 0.80 */
  highUtilizationThreshold: number;
  /** Utilization below which prices fall. Default 0.40 */
  lowUtilizationThreshold: number;
  /** Fractional price increase when high. Default 0.10 (10%) */
  priceIncreaseRate: number;
  /** Fractional price decrease when low. Default 0.05 (5%) */
  priceDecreaseRate: number;
  /** Floor: price never drops below this fraction of base. Default 0.50 */
  minPriceMultiplier: number;
  /** Ceiling: price never rises above this fraction of base. Default 5.0 */
  maxPriceMultiplier: number;
}

const DEFAULT_PRICING_CONFIG: PricingConfig = {
  highUtilizationThreshold: 0.80,
  lowUtilizationThreshold:  0.40,
  priceIncreaseRate:         0.10,
  priceDecreaseRate:         0.05,
  minPriceMultiplier:        0.50,
  maxPriceMultiplier:        5.00,
};

// ─────────────────────────────────────────────────────────
// PricingEngine
// ─────────────────────────────────────────────────────────

/**
 * Tracks supply and demand per resource type and adjusts spot prices
 * based on utilization.
 *
 * Utilization = totalFilled / (totalFilled + activeCapacity)
 *   > highThreshold  → price *= (1 + increaseRate)
 *   < lowThreshold   → price *= (1 − decreaseRate)
 *   otherwise        → price unchanged
 */
export class PricingEngine {
  private metrics = new Map<ResourceType, ResourceMetrics>();
  private config: PricingConfig;

  constructor(config?: Partial<PricingConfig>) {
    this.config = { ...DEFAULT_PRICING_CONFIG, ...config };
    this._initAll();
  }

  // ─── Public API ───────────────────────────────────────

  /** Current spot price for a resource type */
  getPrice(type: ResourceType): number {
    return this._get(type).currentPrice;
  }

  /** All prices as a record */
  allPrices(): Record<string, ResourcePriceInfo> {
    const result: Record<string, ResourcePriceInfo> = {};
    for (const [type, m] of this.metrics) {
      result[type] = {
        current:        m.currentPrice,
        base:           m.basePrice,
        utilization:    this._utilization(m),
        activeListings: m.activeCapacity,
      };
    }
    return result;
  }

  /**
   * Called when new resources are listed.
   * Supply additions do NOT trigger an immediate price adjustment —
   * prices only move in response to demand (fills) or supply removal (cancellations).
   */
  recordListing(type: ResourceType, quantity: number): void {
    const m = this._get(type);
    m.totalListed   += quantity;
    m.activeCapacity += quantity;
    // Price adjusts on demand events, not supply additions
  }

  /** Called when a listing is cancelled / expired without being filled */
  recordCancellation(type: ResourceType, quantity: number): void {
    const m = this._get(type);
    m.activeCapacity = Math.max(0, m.activeCapacity - quantity);
    this._adjustPrice(type);
  }

  /** Called when a buy order is filled */
  recordFill(type: ResourceType, quantity: number): void {
    const m = this._get(type);
    m.totalFilled   += quantity;
    m.activeCapacity = Math.max(0, m.activeCapacity - quantity);
    this._adjustPrice(type);
  }

  /** Utilization fraction for a resource type (0–1) */
  utilization(type: ResourceType): number {
    return this._utilization(this._get(type));
  }

  /** Reset prices to base (useful for testing) */
  reset(): void {
    this._initAll();
  }

  // ─── Private ──────────────────────────────────────────

  private _initAll(): void {
    for (const [type, base] of Object.entries(BASE_PRICES) as [ResourceType, number][]) {
      this.metrics.set(type, {
        basePrice:      base,
        currentPrice:   base,
        totalListed:    0,
        totalFilled:    0,
        activeCapacity: 0,
      });
    }
  }

  private _get(type: ResourceType): ResourceMetrics {
    let m = this.metrics.get(type);
    if (!m) {
      // Unknown type: use a fallback base price
      m = {
        basePrice:      0.01,
        currentPrice:   0.01,
        totalListed:    0,
        totalFilled:    0,
        activeCapacity: 0,
      };
      this.metrics.set(type, m);
    }
    return m;
  }

  private _utilization(m: ResourceMetrics): number {
    const total = m.totalFilled + m.activeCapacity;
    if (total === 0) return 0;
    return m.totalFilled / total;
  }

  private _adjustPrice(type: ResourceType): void {
    const m     = this._get(type);
    const u     = this._utilization(m);
    const cfg   = this.config;

    let next = m.currentPrice;
    if (u > cfg.highUtilizationThreshold) {
      next *= 1 + cfg.priceIncreaseRate;
    } else if (u < cfg.lowUtilizationThreshold && u >= 0) {
      next *= 1 - cfg.priceDecreaseRate;
    }

    // Clamp to floor / ceiling
    const floor   = m.basePrice * cfg.minPriceMultiplier;
    const ceiling = m.basePrice * cfg.maxPriceMultiplier;
    m.currentPrice = Math.max(floor, Math.min(ceiling, next));
  }
}
