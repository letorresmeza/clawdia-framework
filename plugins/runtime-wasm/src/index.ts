import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ExecResult,
  HealthStatus,
  IRuntimeProvider,
  PluginModule,
  RuntimeHandle,
  RuntimeSpec,
} from "@clawdia/types";

interface WasmSession {
  spec: RuntimeSpec;
  startedAt: number;
  logs: string[];
}

export class WasmRuntimeProvider implements IRuntimeProvider {
  readonly name = "wasm";
  private sessions = new Map<string, WasmSession>();

  async spawn(spec: RuntimeSpec): Promise<RuntimeHandle> {
    const handle: RuntimeHandle = {
      id: crypto.randomUUID(),
      name: spec.name,
      runtime: this.name,
    };
    this.sessions.set(handle.id, {
      spec,
      startedAt: Date.now(),
      logs: [`spawned:${spec.name}`],
    });
    return handle;
  }

  async destroy(handle: RuntimeHandle): Promise<void> {
    this.sessions.delete(handle.id);
  }

  async exec(handle: RuntimeHandle, cmd: string): Promise<ExecResult> {
    const session = this.sessions.get(handle.id);
    if (!session) {
      return { stdout: "", stderr: `Unknown handle ${handle.id}`, exitCode: 1 };
    }

    const modulePath = session.spec.command?.[0];
    if (!modulePath) {
      return { stdout: "", stderr: "No WebAssembly module configured", exitCode: 1 };
    }

    const wasmRuntime = (
      globalThis as typeof globalThis & {
        WebAssembly?: { validate(bytes: Uint8Array): boolean };
      }
    ).WebAssembly;
    if (!wasmRuntime) {
      return { stdout: "", stderr: "WebAssembly runtime is not available", exitCode: 1 };
    }

    const bytes = await readFile(resolve(modulePath));
    if (!wasmRuntime.validate(bytes)) {
      return { stdout: "", stderr: `Invalid WebAssembly module: ${modulePath}`, exitCode: 1 };
    }

    const stdout = `validated wasm module ${modulePath} for command: ${cmd}`;
    session.logs.push(stdout);
    return { stdout, stderr: "", exitCode: 0 };
  }

  async *logs(handle: RuntimeHandle): AsyncIterable<string> {
    const session = this.sessions.get(handle.id);
    if (!session) return;
    for (const line of session.logs) {
      yield line;
    }
  }

  async healthCheck(handle: RuntimeHandle): Promise<HealthStatus> {
    const session = this.sessions.get(handle.id);
    if (!session) {
      return { alive: false, uptime: 0 };
    }
    return {
      alive: true,
      uptime: Date.now() - session.startedAt,
    };
  }
}

export default {
  name: "wasm",
  type: "runtime",
  create: () => new WasmRuntimeProvider(),
} satisfies PluginModule<WasmRuntimeProvider>;
