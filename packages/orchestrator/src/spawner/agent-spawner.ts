import type {
  AgentIdentity,
  AgentSession,
  SessionState,
  IRuntimeProvider,
  RuntimeHandle,
} from "@clawdia/types";
import type { IClawBus } from "@clawdia/core";

export interface SpawnOptions {
  identity: AgentIdentity;
  task?: string;
  env?: Record<string, string>;
}

export class AgentSpawner {
  private sessions = new Map<string, AgentSession>();
  private heartbeatIntervals = new Map<string, NodeJS.Timeout>();

  constructor(
    private runtime: IRuntimeProvider,
    private bus: IClawBus,
    private config: { heartbeatIntervalMs: number } = { heartbeatIntervalMs: 30_000 },
  ) {}

  /** Spawn a new agent session */
  async spawn(opts: SpawnOptions): Promise<AgentSession> {
    const sessionId = crypto.randomUUID();

    // Create isolated runtime
    const handle = await this.runtime.spawn({
      name: `clawdia-${opts.identity.name}-${sessionId.slice(0, 8)}`,
      image: opts.identity.runtime.image ?? "node:20-slim",
      memoryMb: opts.identity.runtime.memoryMb ?? 512,
      cpus: opts.identity.runtime.cpus ?? 1,
      env: {
        AGENT_NAME: opts.identity.name,
        AGENT_SESSION: sessionId,
        CLAWBUS_URL: process.env["CLAWBUS_URL"] ?? "nats://localhost:4222",
        ...(opts.env ?? {}),
      },
      command: opts.task ? ["node", "agent.js", "--task", opts.task] : undefined,
    });

    const now = new Date().toISOString();
    const session: AgentSession = {
      id: sessionId,
      identity: opts.identity,
      runtimeHandle: handle,
      state: "running",
      startedAt: now,
      lastHeartbeat: now,
      tasksCompleted: 0,
      activeContracts: [],
    };

    this.sessions.set(sessionId, session);

    // Start health monitoring
    this.startHealthMonitor(sessionId);

    // Publish heartbeat
    await this.bus.publish("heartbeat", {
      sessionId,
      agentName: opts.identity.name,
      uptime: 0,
      resourceUsage: { memoryMb: 0, cpuPercent: 0, activeContracts: 0 },
    }, opts.identity);

    return { ...session };
  }

  /** Kill a running session */
  async kill(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Stop monitoring
    const interval = this.heartbeatIntervals.get(sessionId);
    if (interval) clearInterval(interval);
    this.heartbeatIntervals.delete(sessionId);

    // Destroy runtime
    session.state = "terminating";
    try {
      await this.runtime.destroy(session.runtimeHandle);
    } catch {
      // Container may already be dead
    }
    session.state = "dead";
  }

  /** Pause a session */
  pause(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.state === "running") {
      session.state = "paused";
    }
  }

  /** Resume a paused session */
  resume(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.state === "paused") {
      session.state = "running";
    }
  }

  /** Get a specific session */
  get(sessionId: string): AgentSession | undefined {
    const s = this.sessions.get(sessionId);
    return s ? { ...s } : undefined;
  }

  /** List all sessions */
  list(filter?: { state?: SessionState }): AgentSession[] {
    let results = Array.from(this.sessions.values());
    if (filter?.state) {
      results = results.filter((s) => s.state === filter.state);
    }
    return results.map((s) => ({ ...s }));
  }

  /** Cleanup all sessions */
  async destroyAll(): Promise<void> {
    for (const sessionId of this.sessions.keys()) {
      await this.kill(sessionId);
    }
  }

  private startHealthMonitor(sessionId: string): void {
    const interval = setInterval(async () => {
      const session = this.sessions.get(sessionId);
      if (!session || session.state === "dead") {
        clearInterval(interval);
        this.heartbeatIntervals.delete(sessionId);
        return;
      }

      try {
        const health = await this.runtime.healthCheck(session.runtimeHandle);
        if (!health.alive) {
          session.state = "dead";
          session.error = {
            code: "AGENT_DIED",
            message: "Agent container stopped unexpectedly",
            timestamp: new Date().toISOString(),
          };

          await this.bus.publish("risk.alert", {
            type: "agent_died",
            agent: session.identity.name,
            sessionId,
            details: { lastHeartbeat: session.lastHeartbeat },
          }, session.identity);
        } else {
          session.lastHeartbeat = new Date().toISOString();
        }
      } catch {
        // Health check failed — mark suspicious but don't kill yet
      }
    }, this.config.heartbeatIntervalMs);

    this.heartbeatIntervals.set(sessionId, interval);
  }
}
