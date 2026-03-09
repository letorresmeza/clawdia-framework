/**
 * import-agency-agents.ts
 *
 * Converts every agent .md file from the agency-agents open-source repo into
 * soul.md v2 manifests and writes them to examples/agency-agents/{domain}/{name}/soul.md
 *
 * Usage:
 *   npx tsx scripts/import-agency-agents.ts [--agency-agents-path /path/to/agency-agents]
 *
 * Default source: /tmp/agency-agents
 * Default output: examples/agency-agents/
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = path.join(__dirname, "..");

// ─── Config ───────────────────────────────────────────────────────────────────

const agencyAgentsPath =
  process.argv.find((a) => a.startsWith("--agency-agents-path="))?.split("=")[1] ??
  "/tmp/agency-agents";

const outputBase = path.join(FRAMEWORK_ROOT, "examples", "agency-agents");

/** Directories in the agency-agents repo that contain actual agent .md files */
const AGENT_DIRS = [
  "design",
  "engineering",
  "marketing",
  "product",
  "project-management",
  "spatial-computing",
  "specialized",
  "support",
  "testing",
] as const;

/** Maps source domain → Clawdia capability taxonomy prefix */
const DOMAIN_TAXONOMY_MAP: Record<string, string> = {
  design: "design",
  engineering: "coding",
  marketing: "marketing",
  product: "product",
  "project-management": "management",
  "spatial-computing": "spatial",
  specialized: "specialized",
  support: "support",
  testing: "testing",
};

/** Domains that get $0.05 pricing and 120s SLA (complex tasks) */
const COMPLEX_DOMAINS = new Set(["engineering", "spatial-computing", "specialized"]);

/** Agent name keywords that indicate complexity regardless of domain */
const COMPLEX_KEYWORDS = ["architect", "engineer", "orchestrat", "security", "devops", "ai-engineer"];

// ─── Frontmatter parser ───────────────────────────────────────────────────────

interface Frontmatter {
  name: string;
  description: string;
}

function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: { name: "", description: "" }, body: content };
  }

  const fm = match[1] ?? "";
  const body = (match[2] ?? "").trim();

  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);

  return {
    meta: {
      name: (nameMatch?.[1] ?? "").trim(),
      description: (descMatch?.[1] ?? "").trim(),
    },
    body,
  };
}

// ─── Name / taxonomy derivation ───────────────────────────────────────────────

/**
 * Derives the short agent name from the filename by stripping the domain prefix.
 *
 * design-ui-designer.md           → ui-designer
 * engineering-frontend-developer  → frontend-developer
 * project-management-project-shepherd → project-shepherd
 * project-manager-senior          → project-manager-senior  (no strip — different prefix)
 */
function deriveAgentName(basename: string, domain: string): string {
  const withoutExt = basename.replace(/\.md$/, "");

  // Try to strip "domain-" prefix (e.g. "engineering-")
  const domainPrefix = domain + "-";
  if (withoutExt.startsWith(domainPrefix)) {
    return withoutExt.slice(domainPrefix.length);
  }

  // project-management edge case: some files use "project-manager-" prefix
  if (domain === "project-management" && withoutExt.startsWith("project-manager-")) {
    return withoutExt.slice("project-manager-".length);
  }

  return withoutExt;
}

/**
 * Builds the capability taxonomy string.
 * e.g. domain=engineering, agentName=frontend-developer → "coding.frontend.developer"
 */
function buildTaxonomy(domain: string, agentName: string): string {
  const prefix = DOMAIN_TAXONOMY_MAP[domain] ?? domain;
  // Convert hyphens to dots for dot-notation taxonomy
  const specialization = agentName.replace(/-/g, ".");
  return `${prefix}.${specialization}`;
}

function isComplex(domain: string, agentName: string): boolean {
  if (COMPLEX_DOMAINS.has(domain)) return true;
  return COMPLEX_KEYWORDS.some((kw) => agentName.includes(kw));
}

// ─── soul.md v2 generator ────────────────────────────────────────────────────

function generateSoulMd(opts: {
  agentName: string;
  displayName: string;
  description: string;
  domain: string;
  taxonomy: string;
  originalPrompt: string;
  complex: boolean;
}): string {
  const { agentName, displayName, description, domain, taxonomy, originalPrompt, complex } = opts;

  const pricingAmount = complex ? 0.05 : 0.01;
  const latencyMs = complex ? 120_000 : 30_000;

  // Indent the original prompt for YAML block scalar
  const indentedPrompt = originalPrompt
    .split("\n")
    .map((l) => "    " + l)
    .join("\n");

  return `version: "2.0"
kind: AgentManifest

identity:
  name: ${agentName}
  display_name: "${displayName}"
  description: >
    ${description}
  version: "1.0.0"
  operator: "agency-agents"

capabilities:
  provides:
    - taxonomy: ${taxonomy}
      description: "${description}"
      input_schema:
        type: object
        properties:
          task:
            type: string
            description: "The task or request for this specialist agent"
          context:
            type: object
            description: "Optional additional context"
        required: ["task"]
      output_schema:
        type: object
        properties:
          result:
            type: string
            description: "The agent's response or deliverable"
          artifacts:
            type: array
            items: { type: object }
            description: "Optional structured artifacts produced"
      sla:
        max_latency_ms: ${latencyMs}
        availability: 0.95
      pricing:
        model: per_request
        amount: ${pricingAmount}
        currency: USDC

runtime:
  model: "claude-haiku-4-5-20251001"
  memory_mb: 512
  cpus: 1
  timeout_s: ${complex ? 120 : 30}

reputation:
  registry: "clawdia-mainnet"
  minimum_stake: ${complex ? 5.0 : 1.0}

metadata:
  source: "agency-agents"
  source_url: "https://github.com/msitarzewski/agency-agents"
  domain: "${domain}"
  imported_at: "${new Date().toISOString()}"
  original_prompt: |
${indentedPrompt}
`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface ImportResult {
  domain: string;
  agentName: string;
  taxonomy: string;
  outputPath: string;
}

function main(): void {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Clawdia × agency-agents Importer                       ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`Source: ${agencyAgentsPath}`);
  console.log(`Output: ${outputBase}\n`);

  if (!fs.existsSync(agencyAgentsPath)) {
    console.error(`ERROR: agency-agents repo not found at ${agencyAgentsPath}`);
    console.error("Clone it first: git clone https://github.com/msitarzewski/agency-agents /tmp/agency-agents");
    process.exit(1);
  }

  const results: ImportResult[] = [];
  let skipped = 0;

  for (const domain of AGENT_DIRS) {
    const domainPath = path.join(agencyAgentsPath, domain);

    if (!fs.existsSync(domainPath)) {
      console.warn(`  [SKIP] Directory not found: ${domainPath}`);
      skipped++;
      continue;
    }

    const files = fs.readdirSync(domainPath).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const filePath = path.join(domainPath, file);
      const raw = fs.readFileSync(filePath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);

      if (!meta.name || !meta.description) {
        console.warn(`  [SKIP] No name/description in frontmatter: ${filePath}`);
        skipped++;
        continue;
      }

      const agentName = deriveAgentName(file, domain);
      const taxonomy = buildTaxonomy(domain, agentName);
      const complex = isComplex(domain, agentName);

      // Write to examples/agency-agents/{domain}/{agent-name}/soul.md
      const outDir = path.join(outputBase, domain, agentName);
      fs.mkdirSync(outDir, { recursive: true });

      const soulMd = generateSoulMd({
        agentName,
        displayName: meta.name,
        description: meta.description,
        domain,
        taxonomy,
        originalPrompt: body,
        complex,
      });

      const outPath = path.join(outDir, "soul.md");
      fs.writeFileSync(outPath, soulMd, "utf-8");

      results.push({
        domain,
        agentName,
        taxonomy,
        outputPath: path.relative(FRAMEWORK_ROOT, outPath),
      });

      const complexity = complex ? "complex $0.05" : "simple  $0.01";
      console.log(`  ✓ [${domain.padEnd(20)}] ${agentName.padEnd(32)} → ${taxonomy.padEnd(40)} (${complexity})`);
    }
  }

  // Write a manifest index for the register-all script to consume
  const manifestIndex = {
    generatedAt: new Date().toISOString(),
    totalAgents: results.length,
    agents: results,
  };

  const indexPath = path.join(outputBase, "manifest.json");
  fs.writeFileSync(indexPath, JSON.stringify(manifestIndex, null, 2), "utf-8");

  console.log(`\n${"─".repeat(68)}`);
  console.log(`  Imported:  ${results.length} agents`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Manifest:  examples/agency-agents/manifest.json`);
  console.log(`\n  Run the demo:`);
  console.log(`    npx tsx examples/agency-agents/demo.ts`);
  console.log(`\n  Register all at daemon boot — already wired into daemon.ts`);
  console.log(`${"─".repeat(68)}\n`);
}

main();
