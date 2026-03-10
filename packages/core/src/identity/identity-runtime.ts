import { parse as parseYaml } from "yaml";
import { z } from "zod";
import * as ed from "@noble/ed25519";
import type {
  AgentIdentity,
  Capability,
  Requirement,
  RuntimeRequirements,
  SoulManifestV2,
} from "@clawdia/types";

// ─────────────────────────────────────────────────────────
// Zod schemas for soul.md v2 validation
// ─────────────────────────────────────────────────────────

const CapabilitySchema = z.object({
  taxonomy: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/),
  description: z.string(),
  input_schema: z.record(z.unknown()).default({}),
  output_schema: z.record(z.unknown()).default({}),
  sla: z.object({
    max_latency_ms: z.number().positive(),
    availability: z.number().min(0).max(1),
  }),
  pricing: z.object({
    model: z.enum([
      "per_request",
      "per_minute",
      "flat_rate",
      "per_token",
      "percentage_of_total",
      "subscription",
    ]),
    amount: z.number().nonnegative(),
    currency: z.string(),
  }),
});

const RequirementSchema = z.object({
  taxonomy: z.string(),
  optional: z.boolean().optional(),
});

const RuntimeSchema = z.object({
  model: z.string().optional(),
  image: z.string().optional(),
  memory_mb: z.number().positive().optional(),
  cpus: z.number().positive().optional(),
  timeout_s: z.number().positive().optional(),
  environment: z.array(z.string()).optional(),
});

const AttestationSchema = z.object({
  signer: z.string(),
  claim: z.string(),
  timestamp: z.string(),
});

const ReputationSchema = z.object({
  registry: z.string(),
  minimum_stake: z.number().nonnegative(),
  attestations: z.array(AttestationSchema).optional(),
});

const SoulManifestV2Schema = z.object({
  version: z.literal("2.0"),
  kind: z.literal("AgentManifest"),
  identity: z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
    display_name: z.string(),
    description: z.string(),
    version: z.string(),
    operator: z.string(),
    public_key: z.string().optional(),
  }),
  capabilities: z.object({
    provides: z.array(CapabilitySchema).min(1),
    requires: z.array(RequirementSchema).optional(),
  }),
  runtime: RuntimeSchema,
  reputation: ReputationSchema.optional(),
});

// ─────────────────────────────────────────────────────────
// Crypto helpers
// ─────────────────────────────────────────────────────────

async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    publicKey: `ed25519:${Buffer.from(publicKey).toString("base64")}`,
    privateKey: Buffer.from(privateKey).toString("base64"),
  };
}

// ─────────────────────────────────────────────────────────
// Identity Runtime
// ─────────────────────────────────────────────────────────

export class IdentityRuntime {
  private identities = new Map<string, AgentIdentity>();
  private privateKeys = new Map<string, string>();

  /**
   * Register an agent from a soul.md v2 manifest string.
   * Parses, validates, generates keypair if needed, and stores the identity.
   */
  async register(soulMdContent: string): Promise<AgentIdentity> {
    // Parse YAML
    const raw = parseYaml(soulMdContent);

    // Validate against schema
    const manifest = SoulManifestV2Schema.parse(raw) as SoulManifestV2;

    // Check for duplicate registration
    if (this.identities.has(manifest.identity.name)) {
      throw new Error(`Agent "${manifest.identity.name}" is already registered`);
    }

    // Generate or use provided keypair
    let publicKey: string;
    let privateKey: string | undefined;

    if (manifest.identity.public_key) {
      publicKey = manifest.identity.public_key;
    } else {
      const kp = await generateKeyPair();
      publicKey = kp.publicKey;
      privateKey = kp.privateKey;
    }

    // Build identity
    const identity: AgentIdentity = {
      name: manifest.identity.name,
      displayName: manifest.identity.display_name,
      description: manifest.identity.description,
      version: manifest.identity.version,
      operator: manifest.identity.operator,
      publicKey,
      capabilities: manifest.capabilities.provides.map(
        (c): Capability => ({
          taxonomy: c.taxonomy,
          description: c.description,
          inputSchema: c.input_schema,
          outputSchema: c.output_schema,
          sla: {
            maxLatencyMs: c.sla.max_latency_ms,
            availability: c.sla.availability,
          },
          pricing: {
            model: c.pricing.model as Capability["pricing"]["model"],
            amount: c.pricing.amount,
            currency: c.pricing.currency,
          },
        }),
      ),
      requirements: (manifest.capabilities.requires ?? []).map(
        (r): Requirement => ({
          taxonomy: r.taxonomy,
          optional: r.optional,
        }),
      ),
      runtime: {
        model: manifest.runtime.model,
        image: manifest.runtime.image,
        memoryMb: manifest.runtime.memory_mb,
        cpus: manifest.runtime.cpus,
        timeoutS: manifest.runtime.timeout_s,
        environment: manifest.runtime.environment,
      },
      reputation: manifest.reputation
        ? {
            registry: manifest.reputation.registry,
            minimumStake: manifest.reputation.minimum_stake,
            score: 0,
            dimensions: { reliability: 0, quality: 0, speed: 0, costEfficiency: 0 },
            attestations: (manifest.reputation.attestations ?? []).map((a) => ({
              signer: a.signer,
              claim: a.claim,
              timestamp: a.timestamp,
            })),
          }
        : undefined,
    };

    // Store
    this.identities.set(identity.name, identity);
    if (privateKey) {
      this.privateKeys.set(identity.name, privateKey);
    }

    return identity;
  }

  /** Get a registered agent identity by name */
  get(name: string): AgentIdentity | undefined {
    return this.identities.get(name);
  }

  /** List all registered identities */
  list(): AgentIdentity[] {
    return Array.from(this.identities.values());
  }

  /** Deregister an agent */
  deregister(name: string): boolean {
    this.privateKeys.delete(name);
    return this.identities.delete(name);
  }

  /** Sign a payload with an agent's private key */
  async signPayload(agentName: string, payload: string): Promise<string> {
    const key = this.privateKeys.get(agentName);
    if (!key) {
      throw new Error(`No private key for agent "${agentName}"`);
    }
    const privateKeyBytes = Buffer.from(key, "base64");
    const msgBytes = new TextEncoder().encode(payload);
    const signature = await ed.signAsync(msgBytes, privateKeyBytes);
    return Buffer.from(signature).toString("base64");
  }

  /** Verify a signature against a public key */
  async verifySignature(publicKey: string, payload: string, signature: string): Promise<boolean> {
    try {
      const keyStr = publicKey.replace("ed25519:", "");
      const pubKeyBytes = Buffer.from(keyStr, "base64");
      const msgBytes = new TextEncoder().encode(payload);
      const sigBytes = Buffer.from(signature, "base64");
      return await ed.verifyAsync(sigBytes, msgBytes, pubKeyBytes);
    } catch {
      return false;
    }
  }
}
