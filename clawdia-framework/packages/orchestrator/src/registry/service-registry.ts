import type {
  AgentIdentity,
  RegistryEntry,
  RegistryQuery,
  RegistryQueryResult,
} from "@clawdia/types";
import type { IClawBus } from "@clawdia/core";

export class ServiceRegistry {
  private entries = new Map<string, RegistryEntry>();
  private deregisterTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private bus?: IClawBus,
    private config: { healthCheckIntervalMs: number; deregisterAfterMs: number } = {
      healthCheckIntervalMs: 30_000,
      deregisterAfterMs: 120_000,
    },
  ) {}

  /** Register an agent's capabilities */
  register(identity: AgentIdentity, sessionId?: string): void {
    const now = new Date().toISOString();
    this.entries.set(identity.name, {
      identity,
      registeredAt: now,
      lastSeen: now,
      status: "online",
      sessionId,
    });

    // Start deregister timer
    this.resetDeregisterTimer(identity.name);

    // Publish registry update
    this.bus?.publish("registry.update", {
      agentName: identity.name,
      action: "register",
      identity,
      status: "online",
    }, identity);
  }

  /** Discover agents matching a query */
  discover(query: RegistryQuery): RegistryQueryResult {
    let results = Array.from(this.entries.values());

    // Filter offline unless explicitly included
    if (query.onlineOnly !== false) {
      results = results.filter((e) => e.status !== "offline");
    }

    // Taxonomy filter (supports * wildcard at end)
    if (query.taxonomy) {
      const pattern = query.taxonomy.endsWith("*")
        ? query.taxonomy.slice(0, -1)
        : query.taxonomy;
      const isWildcard = query.taxonomy.endsWith("*");

      results = results.filter((e) =>
        e.identity.capabilities.some((c) =>
          isWildcard ? c.taxonomy.startsWith(pattern) : c.taxonomy === pattern,
        ),
      );
    }

    // Price filter
    if (query.maxPrice !== undefined) {
      results = results.filter((e) =>
        e.identity.capabilities.some((c) => c.pricing.amount <= query.maxPrice!),
      );
    }

    // Currency filter
    if (query.currency) {
      results = results.filter((e) =>
        e.identity.capabilities.some(
          (c) => c.pricing.currency.toLowerCase() === query.currency!.toLowerCase(),
        ),
      );
    }

    // Reputation filter
    if (query.minReputation !== undefined) {
      results = results.filter(
        (e) =>
          e.identity.reputation !== undefined &&
          e.identity.reputation.score >= query.minReputation!,
      );
    }

    // Sort by reputation (highest first)
    results.sort((a, b) => {
      const scoreA = a.identity.reputation?.score ?? 0;
      const scoreB = b.identity.reputation?.score ?? 0;
      return scoreB - scoreA;
    });

    // Apply limit
    const total = results.length;
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return { entries: results, total };
  }

  /** Update heartbeat timestamp for an agent */
  heartbeat(agentName: string): void {
    const entry = this.entries.get(agentName);
    if (entry) {
      entry.lastSeen = new Date().toISOString();
      if (entry.status === "offline") {
        entry.status = "online";
      }
      this.resetDeregisterTimer(agentName);
    }
  }

  /** Update agent status */
  setStatus(agentName: string, status: "online" | "offline" | "busy"): void {
    const entry = this.entries.get(agentName);
    if (entry) {
      entry.status = status;
    }
  }

  /** Deregister an agent */
  deregister(agentName: string): boolean {
    const timer = this.deregisterTimers.get(agentName);
    if (timer) clearTimeout(timer);
    this.deregisterTimers.delete(agentName);

    const entry = this.entries.get(agentName);
    if (entry) {
      this.bus?.publish("registry.update", {
        agentName,
        action: "deregister",
      }, entry.identity);
    }

    return this.entries.delete(agentName);
  }

  /** Get a specific entry */
  get(agentName: string): RegistryEntry | undefined {
    return this.entries.get(agentName);
  }

  /** List all entries */
  list(): RegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /** Get count of registered agents by status */
  stats(): Record<string, number> {
    const stats: Record<string, number> = { online: 0, offline: 0, busy: 0 };
    for (const entry of this.entries.values()) {
      stats[entry.status] = (stats[entry.status] ?? 0) + 1;
    }
    return stats;
  }

  /** Cleanup — clear all timers */
  destroy(): void {
    for (const timer of this.deregisterTimers.values()) {
      clearTimeout(timer);
    }
    this.deregisterTimers.clear();
  }

  private resetDeregisterTimer(agentName: string): void {
    const existing = this.deregisterTimers.get(agentName);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const entry = this.entries.get(agentName);
      if (entry) {
        entry.status = "offline";
      }
    }, this.config.deregisterAfterMs);

    this.deregisterTimers.set(agentName, timer);
  }
}
