import { describe, it, expect, beforeEach } from "vitest";
import { IdentityRuntime } from "../identity/identity-runtime.js";

// ─────────────────────────────────────────────────────────
// Minimal valid soul.md v2 manifest
// ─────────────────────────────────────────────────────────

function makeSoulMd(overrides: Record<string, unknown> = {}): string {
  const base = {
    version: "2.0",
    kind: "AgentManifest",
    identity: {
      name: "test-agent",
      display_name: "Test Agent",
      description: "A test agent",
      version: "1.0.0",
      operator: "test-operator",
      ...(overrides.identity as Record<string, unknown> ?? {}),
    },
    capabilities: {
      provides: [
        {
          taxonomy: "test.capability",
          description: "A test capability",
          input_schema: { type: "object" },
          output_schema: { type: "object" },
          sla: { max_latency_ms: 5000, availability: 0.99 },
          pricing: { model: "per_request", amount: 1.0, currency: "USDC" },
        },
      ],
      ...(overrides.capabilities as Record<string, unknown> ?? {}),
    },
    runtime: {
      model: "test-model",
      ...(overrides.runtime as Record<string, unknown> ?? {}),
    },
    ...(overrides.top as Record<string, unknown> ?? {}),
  };
  // Simple YAML serialization
  return yamlSerialize(base);
}

/** Minimal YAML serializer — enough for our test manifests */
function yamlSerialize(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") return JSON.stringify(obj);
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    return obj
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          const inner = yamlSerialize(item, indent + 1);
          // First line after "- " needs special treatment
          const lines = inner.split("\n");
          return `${pad}- ${lines[0].trimStart()}\n${lines.slice(1).join("\n")}`;
        }
        return `${pad}- ${yamlSerialize(item)}`;
      })
      .join("\n");
  }
  if (typeof obj === "object") {
    return Object.entries(obj as Record<string, unknown>)
      .map(([key, val]) => {
        if (typeof val === "object" && val !== null && !Array.isArray(val)) {
          return `${pad}${key}:\n${yamlSerialize(val, indent + 1)}`;
        }
        if (Array.isArray(val)) {
          return `${pad}${key}:\n${yamlSerialize(val, indent + 1)}`;
        }
        return `${pad}${key}: ${yamlSerialize(val)}`;
      })
      .join("\n");
  }
  return String(obj);
}

// Use the real example soul.md for integration-style tests
const CODING_AGENT_SOUL = `version: "2.0"
kind: AgentManifest

identity:
  name: code-builder
  display_name: "Code Builder"
  description: "Full-stack coding agent"
  version: "1.0.0"
  operator: "clawdia-labs"

capabilities:
  provides:
    - taxonomy: coding.implementation.fullstack
      description: "Implement features from issue descriptions"
      input_schema:
        type: object
      output_schema:
        type: object
      sla:
        max_latency_ms: 600000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.50
        currency: USDC

  requires:
    - taxonomy: data.source.github

runtime:
  model: "claude-sonnet-4-5-20250929"
  image: "node:20-slim"
  memory_mb: 1024
  cpus: 2
  timeout_s: 600
  environment:
    - GITHUB_TOKEN
    - NPM_TOKEN

reputation:
  registry: "clawdia-testnet"
  minimum_stake: 25.0
`;

// ─────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────

describe("IdentityRuntime", () => {
  let runtime: IdentityRuntime;

  beforeEach(() => {
    runtime = new IdentityRuntime();
  });

  // ── register ────────────────────────────────────────────

  describe("register", () => {
    it("registers an agent from a soul.md manifest", async () => {
      const identity = await runtime.register(CODING_AGENT_SOUL);
      expect(identity.name).toBe("code-builder");
      expect(identity.displayName).toBe("Code Builder");
      expect(identity.description).toBe("Full-stack coding agent");
      expect(identity.version).toBe("1.0.0");
      expect(identity.operator).toBe("clawdia-labs");
    });

    it("generates an ed25519 keypair when no public_key is provided", async () => {
      const identity = await runtime.register(CODING_AGENT_SOUL);
      expect(identity.publicKey).toMatch(/^ed25519:/);
    });

    it("uses the provided public_key when present", async () => {
      const soul = `version: "2.0"
kind: AgentManifest
identity:
  name: keyed-agent
  display_name: "Keyed Agent"
  description: "Agent with explicit key"
  version: "1.0.0"
  operator: "test"
  public_key: "ed25519:provided-key"
capabilities:
  provides:
    - taxonomy: test.cap
      description: "test"
      input_schema: {}
      output_schema: {}
      sla:
        max_latency_ms: 1000
        availability: 0.9
      pricing:
        model: per_request
        amount: 0
        currency: USDC
runtime:
  model: "test"
`;
      const identity = await runtime.register(soul);
      expect(identity.publicKey).toBe("ed25519:provided-key");
    });

    it("parses capabilities correctly", async () => {
      const identity = await runtime.register(CODING_AGENT_SOUL);
      expect(identity.capabilities).toHaveLength(1);
      const cap = identity.capabilities[0];
      expect(cap.taxonomy).toBe("coding.implementation.fullstack");
      expect(cap.sla.maxLatencyMs).toBe(600_000);
      expect(cap.sla.availability).toBe(0.99);
      expect(cap.pricing.model).toBe("per_request");
      expect(cap.pricing.amount).toBe(0.5);
      expect(cap.pricing.currency).toBe("USDC");
    });

    it("parses requirements", async () => {
      const identity = await runtime.register(CODING_AGENT_SOUL);
      expect(identity.requirements).toHaveLength(1);
      expect(identity.requirements[0].taxonomy).toBe("data.source.github");
    });

    it("parses runtime configuration", async () => {
      const identity = await runtime.register(CODING_AGENT_SOUL);
      expect(identity.runtime.model).toBe("claude-sonnet-4-5-20250929");
      expect(identity.runtime.image).toBe("node:20-slim");
      expect(identity.runtime.memoryMb).toBe(1024);
      expect(identity.runtime.cpus).toBe(2);
      expect(identity.runtime.timeoutS).toBe(600);
      expect(identity.runtime.environment).toEqual(["GITHUB_TOKEN", "NPM_TOKEN"]);
    });

    it("parses reputation section", async () => {
      const identity = await runtime.register(CODING_AGENT_SOUL);
      expect(identity.reputation).toBeDefined();
      expect(identity.reputation?.registry).toBe("clawdia-testnet");
      expect(identity.reputation?.minimumStake).toBe(25.0);
      expect(identity.reputation?.score).toBe(0);
      expect(identity.reputation?.dimensions).toEqual({
        reliability: 0,
        quality: 0,
        speed: 0,
        costEfficiency: 0,
      });
    });

    it("rejects duplicate registration", async () => {
      await runtime.register(CODING_AGENT_SOUL);
      await expect(runtime.register(CODING_AGENT_SOUL)).rejects.toThrow(
        'Agent "code-builder" is already registered',
      );
    });

    it("rejects invalid YAML", async () => {
      await expect(runtime.register("not: valid: yaml: {{")).rejects.toThrow();
    });

    it("rejects manifest with wrong version", async () => {
      const bad = CODING_AGENT_SOUL.replace('version: "2.0"', 'version: "1.0"');
      await expect(runtime.register(bad)).rejects.toThrow();
    });

    it("rejects manifest with invalid agent name", async () => {
      const bad = CODING_AGENT_SOUL.replace("name: code-builder", "name: INVALID_NAME!");
      await expect(runtime.register(bad)).rejects.toThrow();
    });

    it("rejects manifest missing required fields", async () => {
      const bad = `version: "2.0"
kind: AgentManifest
identity:
  name: missing-stuff
`;
      await expect(runtime.register(bad)).rejects.toThrow();
    });

    it("rejects manifest with invalid taxonomy format", async () => {
      const bad = CODING_AGENT_SOUL.replace(
        "taxonomy: coding.implementation.fullstack",
        "taxonomy: INVALID TAXONOMY",
      );
      await expect(runtime.register(bad)).rejects.toThrow();
    });
  });

  // ── get / list / deregister ─────────────────────────────

  describe("get", () => {
    it("returns a registered identity by name", async () => {
      await runtime.register(CODING_AGENT_SOUL);
      const identity = runtime.get("code-builder");
      expect(identity).toBeDefined();
      expect(identity?.name).toBe("code-builder");
    });

    it("returns undefined for unregistered agents", () => {
      expect(runtime.get("nonexistent")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns all registered identities", async () => {
      await runtime.register(CODING_AGENT_SOUL);
      const list = runtime.list();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("code-builder");
    });

    it("returns empty array when none registered", () => {
      expect(runtime.list()).toEqual([]);
    });
  });

  describe("deregister", () => {
    it("removes a registered agent", async () => {
      await runtime.register(CODING_AGENT_SOUL);
      const result = runtime.deregister("code-builder");
      expect(result).toBe(true);
      expect(runtime.get("code-builder")).toBeUndefined();
    });

    it("returns false for non-existent agents", () => {
      expect(runtime.deregister("nonexistent")).toBe(false);
    });

    it("removes the private key so signing fails", async () => {
      await runtime.register(CODING_AGENT_SOUL);
      runtime.deregister("code-builder");
      await expect(
        runtime.signPayload("code-builder", "test"),
      ).rejects.toThrow('No private key for agent "code-builder"');
    });
  });

  // ── signPayload / verifySignature ───────────────────────

  describe("signing and verification", () => {
    it("signs and verifies a payload round-trip", async () => {
      const identity = await runtime.register(CODING_AGENT_SOUL);
      const payload = JSON.stringify({ action: "test", nonce: 42 });

      const signature = await runtime.signPayload("code-builder", payload);
      expect(signature).toBeDefined();
      expect(typeof signature).toBe("string");

      const valid = await runtime.verifySignature(
        identity.publicKey,
        payload,
        signature,
      );
      expect(valid).toBe(true);
    });

    it("fails verification with wrong payload", async () => {
      const identity = await runtime.register(CODING_AGENT_SOUL);
      const signature = await runtime.signPayload("code-builder", "original");
      const valid = await runtime.verifySignature(
        identity.publicKey,
        "tampered",
        signature,
      );
      expect(valid).toBe(false);
    });

    it("fails verification with wrong key", async () => {
      await runtime.register(CODING_AGENT_SOUL);
      const signature = await runtime.signPayload("code-builder", "test");
      // Use a different valid-looking but wrong key
      const valid = await runtime.verifySignature(
        "ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        "test",
        signature,
      );
      expect(valid).toBe(false);
    });

    it("throws when signing with no private key", async () => {
      await expect(
        runtime.signPayload("nonexistent", "test"),
      ).rejects.toThrow('No private key for agent "nonexistent"');
    });

    it("returns false for malformed signatures", async () => {
      const identity = await runtime.register(CODING_AGENT_SOUL);
      const valid = await runtime.verifySignature(
        identity.publicKey,
        "test",
        "not-valid-base64!!!",
      );
      expect(valid).toBe(false);
    });
  });
});
