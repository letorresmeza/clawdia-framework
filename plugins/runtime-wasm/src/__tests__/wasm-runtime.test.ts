import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { WasmRuntimeProvider } from "../index.js";

const VALID_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

describe("WasmRuntimeProvider", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("spawns a handle and validates a wasm module on exec", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clawdia-wasm-"));
    dirs.push(dir);
    const wasmPath = join(dir, "module.wasm");
    writeFileSync(wasmPath, VALID_WASM);

    const provider = new WasmRuntimeProvider();
    const handle = await provider.spawn({
      name: "wasm-agent",
      command: [wasmPath],
    });

    const result = await provider.exec(handle, "run");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("validated wasm module");

    const health = await provider.healthCheck(handle);
    expect(health.alive).toBe(true);
  });
});
