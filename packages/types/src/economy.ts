// ─────────────────────────────────────────────────────────
// Reputation Engine types
// ─────────────────────────────────────────────────────────

export interface ReputationRecord {
  agentName: string;
  /** Overall score (0.0 - 1.0) */
  overallScore: number;
  /** Dimensional scores */
  dimensions: {
    reliability: number;
    quality: number;
    speed: number;
    costEfficiency: number;
  };
  /** Total contracts completed */
  contractsCompleted: number;
  /** Total contracts failed */
  contractsFailed: number;
  /** Stake amount locked */
  stakedAmount: number;
  /** Currency of stake */
  stakeCurrency: string;
  /** History of reputation changes */
  history: ReputationEvent[];
  /** Last updated */
  updatedAt: string;
}

export interface ReputationEvent {
  contractId: string;
  dimension: "reliability" | "quality" | "speed" | "costEfficiency";
  delta: number;
  reason: string;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────
// Resource Marketplace types
// ─────────────────────────────────────────────────────────

export type ResourceType = "compute_gpu" | "compute_cpu" | "api_credits" | "data_feed" | "memory" | "context_window";

export interface ResourceListing {
  id: string;
  seller: string;
  type: ResourceType;
  /** Available quantity */
  quantity: number;
  /** Unit description */
  unit: string;
  /** Price per unit */
  pricePerUnit: number;
  /** Currency */
  currency: string;
  /** Listing type */
  listingType: "spot" | "reserved";
  /** For reserved: minimum commitment duration in hours */
  minCommitmentHours?: number;
  /** When this listing expires */
  expiresAt?: string;
}

export interface ResourceOrder {
  id: string;
  buyer: string;
  listingId: string;
  /** Resource type (copied from listing for query convenience) */
  resourceType: ResourceType;
  quantity: number;
  /** Price per unit the buyer paid (including platform spread) */
  pricePerUnit: number;
  totalPrice: number;
  /** Platform revenue extracted from this trade */
  platformFee: number;
  currency: string;
  status: "pending" | "filled" | "cancelled" | "expired";
  createdAt: string;
  filledAt?: string;
}

// ─────────────────────────────────────────────────────────
// Marketplace Stats
// ─────────────────────────────────────────────────────────

export interface ResourcePriceInfo {
  current: number;
  base: number;
  utilization: number;
  activeListings: number;
}

export interface MarketplaceStats {
  prices: Record<string, ResourcePriceInfo>;
  recentOrders: ResourceOrder[];
  topSellers: Array<{ seller: string; volume: number; orders: number }>;
  totalVolume: number;
  platformRevenue: number;
  activeListings: number;
  totalOrders: number;
}

// ─────────────────────────────────────────────────────────
// Billing & Metering types
// ─────────────────────────────────────────────────────────

export interface UsageRecord {
  id: string;
  agentName: string;
  resourceType: string;
  quantity: number;
  unit: string;
  cost: number;
  currency: string;
  timestamp: string;
  contractId?: string;
  metadata?: Record<string, unknown>;
}

export interface Invoice {
  id: string;
  operator: string;
  period: { start: string; end: string };
  lineItems: InvoiceLineItem[];
  total: number;
  currency: string;
  status: "draft" | "sent" | "paid" | "overdue";
  createdAt: string;
  paidAt?: string;
}

export interface InvoiceLineItem {
  description: string;
  agentName: string;
  resourceType: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

// ─────────────────────────────────────────────────────────
// Dispute Resolution types
// ─────────────────────────────────────────────────────────

export type DisputeResolutionTier = "automated" | "arbitrator_agent" | "human";

export interface Dispute {
  id: string;
  contractId: string;
  initiatedBy: string;
  reason: string;
  currentTier: DisputeResolutionTier;
  evidence: DisputeEvidence[];
  ruling?: DisputeRuling;
  createdAt: string;
  resolvedAt?: string;
}

export interface DisputeEvidence {
  submittedBy: string;
  type: "contract_terms" | "output_data" | "logs" | "testimony";
  content: unknown;
  timestamp: string;
}

export interface DisputeRuling {
  tier: DisputeResolutionTier;
  decision: "requester_wins" | "provider_wins" | "split";
  /** Percentage to requester (0-100) */
  splitPercent?: number;
  reasoning: string;
  ruledBy: string;
  timestamp: string;
}
