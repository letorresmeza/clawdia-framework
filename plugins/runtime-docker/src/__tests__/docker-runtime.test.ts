import { describe, it, expect, afterEach, beforeAll } from "vitest";
import Docker from "dockerode";
import { DockerRuntimeProvider } from "../index.js";
import type { RuntimeHandle } from "@clawdia/types";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

// Track handles for cleanup
const handles: RuntimeHandle[] = [];

beforeAll(async () => {
  // Verify Docker is available
  try {
    await docker.ping();
  } catch {
    throw new Error("Docker is not available. Ensure the Docker daemon is running.");
  }
});

afterEach(async () => {
  // Clean up all containers created during tests
  const provider = new DockerRuntimeProvider();
  for (const handle of handles) {
    try {
      await provider.destroy(handle);
    } catch {
      // Already removed
    }
  }
  handles.length = 0;
});

describe("DockerRuntimeProvider", () => {
  it("has the correct name", () => {
    const provider = new DockerRuntimeProvider();
    expect(provider.name).toBe("docker");
  });

  describe("spawn", () => {
    it("creates and starts a container", async () => {
      const provider = new DockerRuntimeProvider();
      const handle = await provider.spawn({
        name: `clawdia-test-spawn-${Date.now()}`,
        image: "alpine:latest",
        command: ["sleep", "300"],
      });
      handles.push(handle);

      expect(handle.id).toBeDefined();
      expect(handle.name).toContain("clawdia-test-spawn");
      expect(handle.runtime).toBe("docker");

      // Verify the container is running
      const container = docker.getContainer(handle.id);
      const info = await container.inspect();
      expect(info.State?.Running).toBe(true);
    }, 30_000);

    it("applies memory limits", async () => {
      const provider = new DockerRuntimeProvider();
      const handle = await provider.spawn({
        name: `clawdia-test-mem-${Date.now()}`,
        image: "alpine:latest",
        memoryMb: 64,
        command: ["sleep", "300"],
      });
      handles.push(handle);

      const container = docker.getContainer(handle.id);
      const info = await container.inspect();
      expect(info.HostConfig?.Memory).toBe(64 * 1024 * 1024);
    }, 30_000);

    it("sets environment variables", async () => {
      const provider = new DockerRuntimeProvider();
      const handle = await provider.spawn({
        name: `clawdia-test-env-${Date.now()}`,
        image: "alpine:latest",
        env: { TEST_VAR: "hello", AGENT_NAME: "test-agent" },
        command: ["sleep", "300"],
      });
      handles.push(handle);

      const result = await provider.exec(handle, "echo $TEST_VAR");
      expect(result.stdout.trim()).toBe("hello");
      expect(result.exitCode).toBe(0);
    }, 30_000);

    it("applies clawdia labels", async () => {
      const provider = new DockerRuntimeProvider();
      const name = `clawdia-test-labels-${Date.now()}`;
      const handle = await provider.spawn({
        name,
        image: "alpine:latest",
        command: ["sleep", "300"],
      });
      handles.push(handle);

      const container = docker.getContainer(handle.id);
      const info = await container.inspect();
      expect(info.Config?.Labels?.["clawdia.managed"]).toBe("true");
      expect(info.Config?.Labels?.["clawdia.agent"]).toBe(name);
    }, 30_000);
  });

  describe("destroy", () => {
    it("stops and removes the container", async () => {
      const provider = new DockerRuntimeProvider();
      const handle = await provider.spawn({
        name: `clawdia-test-destroy-${Date.now()}`,
        image: "alpine:latest",
        command: ["sleep", "300"],
      });

      await provider.destroy(handle);

      // Container should be gone
      try {
        await docker.getContainer(handle.id).inspect();
        expect.fail("Container should have been removed");
      } catch (err) {
        expect((err as { statusCode?: number }).statusCode).toBe(404);
      }
    }, 30_000);

    it("handles destroying a non-existent container gracefully", async () => {
      const provider = new DockerRuntimeProvider();
      // Should not throw
      await provider.destroy({ id: "nonexistent", name: "ghost", runtime: "docker" });
    });
  });

  describe("exec", () => {
    it("runs a command and captures stdout", async () => {
      const provider = new DockerRuntimeProvider();
      const handle = await provider.spawn({
        name: `clawdia-test-exec-${Date.now()}`,
        image: "alpine:latest",
        command: ["sleep", "300"],
      });
      handles.push(handle);

      const result = await provider.exec(handle, "echo 'hello world'");
      expect(result.stdout.trim()).toBe("hello world");
      expect(result.exitCode).toBe(0);
    }, 30_000);

    it("captures stderr", async () => {
      const provider = new DockerRuntimeProvider();
      const handle = await provider.spawn({
        name: `clawdia-test-exec-stderr-${Date.now()}`,
        image: "alpine:latest",
        command: ["sleep", "300"],
      });
      handles.push(handle);

      const result = await provider.exec(handle, "echo 'oops' >&2");
      expect(result.stderr.trim()).toBe("oops");
    }, 30_000);

    it("returns non-zero exit code on failure", async () => {
      const provider = new DockerRuntimeProvider();
      const handle = await provider.spawn({
        name: `clawdia-test-exec-fail-${Date.now()}`,
        image: "alpine:latest",
        command: ["sleep", "300"],
      });
      handles.push(handle);

      const result = await provider.exec(handle, "exit 42");
      expect(result.exitCode).toBe(42);
    }, 30_000);
  });

  describe("healthCheck", () => {
    it("returns alive=true for a running container", async () => {
      const provider = new DockerRuntimeProvider();
      const handle = await provider.spawn({
        name: `clawdia-test-health-${Date.now()}`,
        image: "alpine:latest",
        command: ["sleep", "300"],
      });
      handles.push(handle);

      const health = await provider.healthCheck(handle);
      expect(health.alive).toBe(true);
      expect(health.uptime).toBeGreaterThan(0);
    }, 30_000);

    it("returns alive=false for a non-existent container", async () => {
      const provider = new DockerRuntimeProvider();
      const health = await provider.healthCheck({
        id: "nonexistent",
        name: "ghost",
        runtime: "docker",
      });
      expect(health.alive).toBe(false);
    });

    it("returns alive=false for a stopped container", async () => {
      const provider = new DockerRuntimeProvider();
      const handle = await provider.spawn({
        name: `clawdia-test-health-stopped-${Date.now()}`,
        image: "alpine:latest",
        command: ["sleep", "300"],
      });
      handles.push(handle);

      // Stop the container
      const container = docker.getContainer(handle.id);
      await container.stop({ t: 1 });

      const health = await provider.healthCheck(handle);
      expect(health.alive).toBe(false);
    }, 30_000);
  });

  describe("logs", () => {
    it("streams container logs", async () => {
      const provider = new DockerRuntimeProvider();
      const handle = await provider.spawn({
        name: `clawdia-test-logs-${Date.now()}`,
        image: "alpine:latest",
        command: ["sh", "-c", "echo 'log line 1' && echo 'log line 2'"],
      });
      handles.push(handle);

      // Wait for command to execute
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const logLines: string[] = [];
      const timeout = setTimeout(() => {}, 5000);
      try {
        for await (const line of provider.logs(handle)) {
          logLines.push(line.trim());
          if (logLines.length >= 2) break;
        }
      } finally {
        clearTimeout(timeout);
      }

      const combined = logLines.join("\n");
      expect(combined).toContain("log line 1");
      expect(combined).toContain("log line 2");
    }, 30_000);
  });
});
