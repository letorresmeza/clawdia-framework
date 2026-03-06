import type {
  AgentSession,
  RegistryEntry,
  TaskContract,
  ContractState,
  ReputationRecord,
  EscrowHandle,
  UsageRecord,
  ResourceListing,
  ResourceOrder,
  ResourcePriceInfo,
} from "@clawdia/types";

export interface SessionsResponse {
  sessions: AgentSession[];
  stats: {
    total: number;
    running: number;
    paused: number;
    dead: number;
  };
}

export interface RegistryResponse {
  entries: RegistryEntry[];
  stats: Record<string, number>;
}

export interface ContractsResponse {
  contracts: TaskContract[];
  stats: Record<string, number>;
  filter?: ContractState;
}

export interface MarketplaceResponse {
  prices: Record<string, ResourcePriceInfo>;
  recentOrders: ResourceOrder[];
  topSellers: Array<{ seller: string; volume: number; orders: number }>;
  totalVolume: number;
  platformRevenue: number;
  activeListings: number;
  totalOrders: number;
  listings: ResourceListing[];
}

export interface OrchestrationActiveWorkflow {
  contractId: string;
  capability: string;
  requester: string;
  provider: string;
  state: string;
  createdAt: string;
  payment: { amount: number; currency: string };
}

export interface OrchestrationJob {
  contractId: string;
  workflowId: string | null;
  status: string;
  qualityScore: number | null;
  totalChargedUsdc: number;
  marginUsdc: number;
  stepsCompleted: number;
  stepsTotal: number;
  durationMs: number;
  settledAt: string;
}

export interface AgentUtilizationEntry {
  agentName: string;
  tasksCompleted: number;
  tasksFailed: number;
  averageQualityScore: number | null;
  successRate: number;
}

export interface OrchestrationResponse {
  summary: {
    activeWorkflows: number;
    completedJobs: number;
    totalBrokeredUsdc: number;
    totalMarginUsdc: number;
    registeredSpecialists: number;
    brokerOnline: boolean;
  };
  activeWorkflows: OrchestrationActiveWorkflow[];
  recentJobs: OrchestrationJob[];
  agentUtilization: AgentUtilizationEntry[];
  qualityByAgent: AgentUtilizationEntry[];
  contractStats: Record<string, number>;
}

export interface EconomyResponse {
  reputation: {
    records: ReputationRecord[];
    stats: { totalAgents: number; averageScore: number; aboveThreshold: number };
  };
  escrow: {
    escrows: EscrowHandle[];
    stats: { totalEscrows: number; funded: number; released: number; disputed: number; totalValue: number };
  };
  billing: {
    recentRecords: UsageRecord[];
    stats: { totalRecords: number; totalRevenue: number; totalFees: number; invoiceCount: number };
  };
}
