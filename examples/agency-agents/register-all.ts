/**
 * register-all.ts
 *
 * Reads every soul.md file generated from the agency-agents collection and
 * bulk-registers them with a Clawdia ServiceRegistry.
 *
 * This is called by the daemon on startup so all 61 specialist agents are
 * immediately discoverable when Clawdia boots.
 *
 * Usage (standalone):
 *   npx tsx examples/agency-agents/register-all.ts
 *
 * Usage (from daemon or orchestrator):
 *   import { registerAgencyAgents } from "./examples/agency-agents/register-all.js";
 *   await registerAgencyAgents(registry);
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentIdentity } from "@clawdia/types";
import { ServiceRegistry } from "@clawdia/orchestrator";
import { InMemoryBus } from "@clawdia/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = path.join(__dirname, "..", "..");
const AGENCY_AGENTS_DIR = path.join(FRAMEWORK_ROOT, "examples", "agency-agents");
const MANIFEST_PATH = path.join(AGENCY_AGENTS_DIR, "manifest.json");

const MOCK_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

// ─── Manifest types ────────────────────────────────────────────────────────────

interface ManifestEntry {
  domain: string;
  agentName: string;
  taxonomy: string;
  outputPath: string;
}

interface Manifest {
  generatedAt: string;
  totalAgents: number;
  agents: ManifestEntry[];
}

// ─── soul.md parser (minimal — extracts what we need for AgentIdentity) ───────

interface ParsedSoul {
  name: string;
  displayName: string;
  description: string;
  taxonomy: string;
  latencyMs: number;
  availability: number;
  pricingAmount: number;
  timeoutS: number;
  minStake: number;
}

function parseSoulMd(content: string): ParsedSoul | null {
  // identity.name
  const nameMatch = content.match(/^  name:\s+(.+)$/m);
  const displayNameMatch = content.match(/^  display_name:\s+"(.+)"$/m);
  const descMatch = content.match(/^  description:\s*>\s*\n\s+(.+)/m);
  const taxonomyMatch = content.match(/taxonomy:\s+(\S+)/m);
  const latencyMatch = content.match(/max_latency_ms:\s+(\d+)/m);
  const availMatch = content.match(/availability:\s+([\d.]+)/m);
  const amountMatch = content.match(/amount:\s+([\d.]+)/m);
  const timeoutMatch = content.match(/timeout_s:\s+(\d+)/m);
  const stakeMatch = content.match(/minimum_stake:\s+([\d.]+)/m);

  if (!nameMatch || !taxonomyMatch) return null;

  return {
    name: (nameMatch[1] ?? "").trim(),
    displayName: (displayNameMatch?.[1] ?? (nameMatch[1] ?? "")).trim(),
    description: (descMatch?.[1] ?? "Specialist agent from agency-agents collection").trim(),
    taxonomy: (taxonomyMatch[1] ?? "").trim(),
    latencyMs: parseInt(latencyMatch?.[1] ?? "30000", 10),
    availability: parseFloat(availMatch?.[1] ?? "0.95"),
    pricingAmount: parseFloat(amountMatch?.[1] ?? "0.01"),
    timeoutS: parseInt(timeoutMatch?.[1] ?? "30", 10),
    minStake: parseFloat(stakeMatch?.[1] ?? "1.0"),
  };
}

// ─── Build AgentIdentity from parsed soul.md ──────────────────────────────────

function buildAgentIdentity(soul: ParsedSoul): AgentIdentity {
  return {
    name: soul.name,
    displayName: soul.displayName,
    description: soul.description,
    version: "1.0.0",
    operator: "agency-agents",
    publicKey: MOCK_KEY,
    capabilities: [
      {
        taxonomy: soul.taxonomy,
        description: soul.description,
        inputSchema: {
          type: "object",
          properties: {
            task: { type: "string" },
            context: { type: "object" },
          },
        },
        outputSchema: {
          type: "object",
          properties: {
            result: { type: "string" },
          },
        },
        sla: {
          maxLatencyMs: soul.latencyMs,
          availability: soul.availability,
        },
        pricing: {
          model: "per_request",
          amount: soul.pricingAmount,
          currency: "USDC",
        },
      },
    ],
    requirements: [],
    runtime: {
      model: "claude-haiku-4-5-20251001",
      memoryMb: 512,
      cpus: 1,
      timeoutS: soul.timeoutS,
    },
    reputation: {
      registry: "clawdia-mainnet",
      score: 0.80 + Math.random() * 0.15,
      minimumStake: soul.minStake,
      dimensions: {
        reliability: 0.88,
        quality: 0.85,
        speed: 0.82,
        costEfficiency: 0.90,
      },
      attestations: [
        {
          signer: "agency-agents",
          claim: "Open-source specialist agent — imported from msitarzewski/agency-agents",
          timestamp: new Date().toISOString(),
        },
      ],
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RegisterResult {
  total: number;
  registered: number;
  failed: number;
  identities: AgentIdentity[];
}

/**
 * Reads all generated soul.md files and registers them with the given registry.
 * Returns a summary of what was registered.
 */
export function registerAgencyAgents(registry: ServiceRegistry): RegisterResult {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.warn(
      "[agency-agents] manifest.json not found. Run: npx tsx scripts/import-agency-agents.ts",
    );
    return { total: 0, registered: 0, failed: 0, identities: [] };
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;
  const identities: AgentIdentity[] = [];
  let failed = 0;

  for (const entry of manifest.agents) {
    const soulPath = path.join(FRAMEWORK_ROOT, entry.outputPath);

    if (!fs.existsSync(soulPath)) {
      console.warn(`[agency-agents] Missing soul.md: ${entry.outputPath}`);
      failed++;
      continue;
    }

    const content = fs.readFileSync(soulPath, "utf-8");
    const soul = parseSoulMd(content);

    if (!soul) {
      console.warn(`[agency-agents] Failed to parse: ${entry.outputPath}`);
      failed++;
      continue;
    }

    const identity = buildAgentIdentity(soul);
    registry.register(identity);
    identities.push(identity);
  }

  return {
    total: manifest.totalAgents,
    registered: identities.length,
    failed,
    identities,
  };
}

/**
 * Returns all AgentIdentity objects without registering them.
 * Useful for inspection and the daemon heartbeat loop.
 */
export function loadAgencyAgentIdentities(): AgentIdentity[] {
  if (!fs.existsSync(MANIFEST_PATH)) return [];

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;
  const identities: AgentIdentity[] = [];

  for (const entry of manifest.agents) {
    const soulPath = path.join(FRAMEWORK_ROOT, entry.outputPath);
    if (!fs.existsSync(soulPath)) continue;

    const content = fs.readFileSync(soulPath, "utf-8");
    const soul = parseSoulMd(content);
    if (!soul) continue;

    identities.push(buildAgentIdentity(soul));
  }

  return identities;
}

// ─── Standalone entry ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Clawdia × agency-agents — Bulk Registration             ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const bus = new InMemoryBus();
  await bus.connect();
  const registry = new ServiceRegistry(bus);

  const result = registerAgencyAgents(registry);

  console.log(`  Registered: ${result.registered}/${result.total} agents`);
  if (result.failed > 0) {
    console.log(`  Failed:     ${result.failed}`);
  }
  console.log();

  // Print registry by domain
  const byDomain = new Map<string, AgentIdentity[]>();
  for (const id of result.identities) {
    const taxonomy = id.capabilities[0]?.taxonomy ?? "";
    const domain = taxonomy.split(".")[0] ?? "unknown";
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(id);
  }

  for (const [domain, agents] of byDomain) {
    console.log(`  ${domain.toUpperCase().padEnd(16)} (${agents.length} agents)`);
    for (const agent of agents) {
      const taxonomy = agent.capabilities[0]?.taxonomy ?? "";
      const price = agent.capabilities[0]?.pricing.amount ?? 0;
      console.log(`    • ${agent.displayName.padEnd(36)} ${taxonomy.padEnd(44)} $${price}`);
    }
    console.log();
  }

  const stats = registry.stats() as Record<string, number>;
  console.log(`Registry stats: online=${stats["online"] ?? 0} offline=${stats["offline"] ?? 0}`);

  await bus.disconnect();
}

// Run if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
