import type {
  AgentSession,
  RegistryEntry,
  TaskContract,
  ContractState,
  ReputationRecord,
  EscrowHandle,
  UsageRecord,
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
