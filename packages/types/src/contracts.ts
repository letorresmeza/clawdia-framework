import type { AgentIdentity, JsonSchema } from "./identity.js";

// ─────────────────────────────────────────────────────────
// Task Contract — governs every agent-to-agent engagement
// ─────────────────────────────────────────────────────────

/** All possible contract states */
export type ContractState =
  | "draft"
  | "offered"
  | "accepted"
  | "in_progress"
  | "delivered"
  | "verified"
  | "settled"
  | "disputed"
  | "cancelled";

/** State machine events that trigger transitions */
export type ContractEvent =
  | "OFFER"
  | "ACCEPT"
  | "FUND"
  | "DELIVER"
  | "VERIFY"
  | "SETTLE"
  | "REJECT"
  | "FAIL"
  | "TIMEOUT"
  | "RESOLVE"
  | "CANCEL";

/** The core Task Contract data structure */
export interface TaskContract {
  /** Unique contract identifier */
  id: string;
  /** Current state */
  state: ContractState;
  /** Optimistic concurrency version — incremented on every transition */
  version: number;
  /** Agent requesting the work */
  requester: AgentIdentity;
  /** Agent providing the work (set on acceptance) */
  provider?: AgentIdentity;
  /** Required capability taxonomy */
  capability: string;
  /** Expected input format */
  inputSchema: JsonSchema;
  /** Expected output format */
  outputSchema: JsonSchema;
  /** The actual input data */
  input?: unknown;
  /** The delivered output data */
  output?: unknown;
  /** Payment terms */
  payment: ContractPayment;
  /** Service level agreement */
  sla: ContractSLA;
  /** Verification criteria */
  verification: ContractVerification;
  /** Cryptographic signatures */
  signatures: ContractSignatures;
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
  /** State transition history */
  history: ContractHistoryEntry[];
}

export interface ContractPayment {
  /** Payment amount */
  amount: number;
  /** Currency */
  currency: string;
  /** Escrow handle (set when funded) */
  escrowHandle?: string;
  /** Whether milestone payments are enabled */
  milestones?: ContractMilestone[];
}

export interface ContractMilestone {
  /** Milestone identifier */
  id: string;
  /** Description */
  description: string;
  /** Percentage of total payment */
  percentage: number;
  /** Whether this milestone is complete */
  completed: boolean;
}

export interface ContractSLA {
  /** Maximum time to complete in ms */
  deadlineMs: number;
  /** Maximum retries on failure */
  maxRetries: number;
  /** Maximum latency per request in ms */
  maxLatencyMs?: number;
  /** Penalty for SLA violation (percentage of payment) */
  penaltyPercent?: number;
}

export interface ContractVerification {
  /** Verification method */
  method: "schema_match" | "quality_score" | "human_review" | "composite";
  /** Minimum quality score (0.0 - 1.0) if using quality_score */
  minQualityScore?: number;
  /** Whether human-in-the-loop gate is required */
  requireHumanApproval?: boolean;
  /** Custom verification function identifier */
  customVerifier?: string;
}

export interface ContractSignatures {
  /** Requester's signature of the contract terms */
  requester?: string;
  /** Provider's signature accepting the contract */
  provider?: string;
}

export interface ContractHistoryEntry {
  /** Previous state */
  from: ContractState;
  /** New state */
  to: ContractState;
  /** Event that triggered the transition */
  event: ContractEvent;
  /** When the transition occurred */
  timestamp: string;
  /** Who triggered the transition */
  triggeredBy: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────
// Contract creation spec (without generated fields)
// ─────────────────────────────────────────────────────────

export type CreateContractSpec = Omit<
  TaskContract,
  "id" | "state" | "version" | "createdAt" | "updatedAt" | "history" | "output"
>;
