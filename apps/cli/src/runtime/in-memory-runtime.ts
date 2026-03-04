import type {
  IRuntimeProvider,
  RuntimeSpec,
  RuntimeHandle,
  ExecResult,
  HealthStatus,
} from "@clawdia/types";

/**
 * Stub in-process runtime provider for local dev / CLI usage.
 * No real containers — just tracks handles in memory.
 */
export class InMemoryRuntimeProvider implements IRuntimeProvider {
  readonly name = "in-memory";
  private handles = new Map<string, { spec: RuntimeSpec; startedAt: number; alive: boolean }>();

  async spawn(spec: RuntimeSpec): Promise<RuntimeHandle> {
    const id = crypto.randomUUID();
    this.handles.set(id, { spec, startedAt: Date.now(), alive: true });
    return { id, name: spec.name, runtime: this.name };
  }

  async destroy(handle: RuntimeHandle): Promise<void> {
    const entry = this.handles.get(handle.id);
    if (entry) {
      entry.alive = false;
    }
    this.handles.delete(handle.id);
  }

  async exec(_handle: RuntimeHandle, _cmd: string): Promise<ExecResult> {
    return { stdout: "", stderr: "in-memory runtime does not support exec", exitCode: 1 };
  }

  async *logs(_handle: RuntimeHandle): AsyncIterable<string> {
    yield "[in-memory runtime — no logs available]";
  }

  async healthCheck(handle: RuntimeHandle): Promise<HealthStatus> {
    const entry = this.handles.get(handle.id);
    if (!entry) {
      return { alive: false, uptime: 0 };
    }
    return {
      alive: entry.alive,
      uptime: Date.now() - entry.startedAt,
    };
  }
}
