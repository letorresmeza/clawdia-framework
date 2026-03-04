// ─────────────────────────────────────────────────────────
// Agent Identity — derived from soul.md v2 manifests
// ─────────────────────────────────────────────────────────

export interface AgentIdentity {
  /** Unique machine name (lowercase, hyphens only) */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Agent description */
  description: string;
  /** Semantic version */
  version: string;
  /** Operator/owner identifier */
  operator: string;
  /** Ed25519 public key (base64 encoded) */
  publicKey: string;
  /** Private key — never transmitted, only held by IdentityRuntime */
  privateKey?: string;
  /** Capabilities this agent provides */
  capabilities: Capability[];
  /** Dependencies this agent requires */
  requirements: Requirement[];
  /** Runtime configuration */
  runtime: RuntimeRequirements;
  /** Current reputation snapshot (if registered) */
  reputation?: ReputationSnapshot;
}

export interface Capability {
  /** Hierarchical taxonomy e.g. "analysis.market.sentiment" */
  taxonomy: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for input validation */
  inputSchema: JsonSchema;
  /** JSON Schema for output validation */
  outputSchema: JsonSchema;
  /** Service level agreement */
  sla: CapabilitySLA;
  /** Pricing model */
  pricing: CapabilityPricing;
}

export interface CapabilitySLA {
  /** Maximum acceptable latency in milliseconds */
  maxLatencyMs: number;
  /** Target availability (0.0 - 1.0) */
  availability: number;
}

export interface CapabilityPricing {
  /** Pricing model type */
  model: "per_request" | "per_minute" | "flat_rate" | "per_token";
  /** Price amount */
  amount: number;
  /** Currency (USDC, USDT, USD, etc.) */
  currency: string;
}

export interface Requirement {
  /** Required capability taxonomy */
  taxonomy: string;
  /** Whether this requirement is optional */
  optional?: boolean;
}

export interface RuntimeRequirements {
  /** AI model identifier */
  model?: string;
  /** Container image (for Docker runtime) */
  image?: string;
  /** Memory limit in MB */
  memoryMb?: number;
  /** CPU count */
  cpus?: number;
  /** Task timeout in seconds */
  timeoutS?: number;
  /** Required environment variables */
  environment?: string[];
}

export interface ReputationSnapshot {
  /** Registry this reputation belongs to */
  registry: string;
  /** Overall reputation score (0.0 - 1.0) */
  score: number;
  /** Minimum stake required */
  minimumStake: number;
  /** Dimensional breakdown */
  dimensions: {
    reliability: number;
    quality: number;
    speed: number;
    costEfficiency: number;
  };
  /** Third-party attestations */
  attestations: Attestation[];
}

export interface Attestation {
  /** Public key of the signer */
  signer: string;
  /** What is being attested */
  claim: string;
  /** When the attestation was made */
  timestamp: string;
  /** Signature of the claim */
  signature?: string;
}

// ─────────────────────────────────────────────────────────
// soul.md v2 raw manifest (pre-parse)
// ─────────────────────────────────────────────────────────

export interface SoulManifestV2 {
  version: "2.0";
  kind: "AgentManifest";
  identity: {
    name: string;
    display_name: string;
    description: string;
    version: string;
    operator: string;
    public_key?: string;
  };
  capabilities: {
    provides: Array<{
      taxonomy: string;
      description: string;
      input_schema: JsonSchema;
      output_schema: JsonSchema;
      sla: { max_latency_ms: number; availability: number };
      pricing: { model: string; amount: number; currency: string };
    }>;
    requires?: Array<{ taxonomy: string; optional?: boolean }>;
  };
  runtime: {
    model?: string;
    image?: string;
    memory_mb?: number;
    cpus?: number;
    timeout_s?: number;
    environment?: string[];
  };
  reputation?: {
    registry: string;
    minimum_stake: number;
    attestations?: Array<{
      signer: string;
      claim: string;
      timestamp: string;
    }>;
  };
}

// Flexible JSON Schema type
export type JsonSchema = Record<string, unknown>;
