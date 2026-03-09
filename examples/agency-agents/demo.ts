/**
 * examples/agency-agents/demo.ts
 *
 * Clawdia brokers a complex creative+engineering request across 4 agency-agents:
 *
 *   "Design and build a landing page for an AI agent marketplace"
 *
 * Workflow:
 *   st-1  design.ux.researcher      → user needs + information architecture
 *   st-2  design.ui.designer        → visual design system + component specs  (depends on st-1)
 *   st-3  coding.frontend.developer → full React implementation               (depends on st-2)
 *   st-4  design.brand.guardian     → brand consistency audit + refinements   (depends on st-3)
 *
 * Each step is a real TaskContract driven through the 9-state machine.
 *
 * Usage:
 *   npx tsx examples/agency-agents/demo.ts
 */

import { InMemoryBus, ContractEngine } from "@clawdia/core";
import { ServiceRegistry } from "@clawdia/orchestrator";
import { ReputationEngine, InMemoryEscrow, BillingEngine } from "@clawdia/economy";
import { createAgent } from "@clawdia/sdk";
import type { AgentTask } from "@clawdia/sdk";
import type { AgentIdentity } from "@clawdia/types";
import { registerAgencyAgents } from "./register-all.js";

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const BOLD = (s: string): string => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const GREEN = (s: string): string => `\x1b[32m${s}\x1b[0m`;
const CYAN = (s: string): string => `\x1b[36m${s}\x1b[0m`;
const MAGENTA = (s: string): string => `\x1b[35m${s}\x1b[0m`;
const YELLOW = (s: string): string => `\x1b[33m${s}\x1b[0m`;
const BLUE = (s: string): string => `\x1b[34m${s}\x1b[0m`;

function sep(char = "─", width = 72): string { return DIM(char.repeat(width)); }
function banner(text: string): void {
  console.log("\n" + sep("═"));
  console.log(BOLD(`  ${text}`));
  console.log(sep("═") + "\n");
}
function step(n: number, label: string): void {
  console.log(`\n${CYAN(`Step ${n}:`)} ${BOLD(label)}`);
  console.log(sep());
}

// ─── Mock task handlers ───────────────────────────────────────────────────────

function uxResearcherHandler({ input, ctx }: AgentTask): Promise<unknown> {
  const { project } = input as { project: string };
  ctx.log(`Running UX research for: ${project}`);
  return Promise.resolve({
    user_personas: [
      { name: "Developer Dani", goal: "Find the right specialist agent quickly", pain: "Too many agents, no easy discovery" },
      { name: "Founder Felix", goal: "Hire multiple agents to launch faster", pain: "No trust signals, hard to compare pricing" },
      { name: "Operator Olivia", goal: "Monitor agents and SLAs at scale", pain: "No unified dashboard or alerting" },
    ],
    information_architecture: {
      hero: "Value prop + CTA",
      sections: ["Agent Discovery", "Capability Taxonomy", "Pricing & SLAs", "Reputation Engine", "Live Demo"],
    },
    key_insights: [
      "Trust signals (reputation scores, attestations) are the #1 conversion factor",
      "Capability taxonomy search must be instant — under 200ms",
      "Pricing transparency increases conversion by 34% (industry data)",
      "Live workflow demos outperform static screenshots 3:1 in engagement",
    ],
    recommended_flows: [
      "Browse by capability → compare agents → view SLAs → hire in one click",
      "Natural language search → Clawdia decomposes → shows agent candidates",
    ],
  });
}

function uiDesignerHandler({ input, ctx }: AgentTask): Promise<unknown> {
  const { architecture, personas } = input as {
    architecture: { sections: string[] };
    personas: Array<{ name: string }>;
  };
  ctx.log(`Designing UI system for ${personas?.length ?? 3} personas`);
  return Promise.resolve({
    design_system: {
      colors: {
        primary: "#58a6ff",      // Electric blue
        accent: "#3fb950",       // Terminal green
        surface: "#161b22",      // Dark card
        background: "#0d1117",   // Near-black
        text: "#e6edf3",
        muted: "#8b949e",
      },
      typography: {
        heading: "'SF Mono', 'Fira Code', monospace — code-aesthetic headings",
        body: "Inter, system-ui — clean readable body copy",
        mono: "'SF Mono', 'Cascadia Code' — capability taxonomy labels",
      },
      components: [
        "AgentCard — reputation score, capability badges, price, hire CTA",
        "TaxonomyBrowser — hierarchical capability tree with search",
        "ContractTimeline — live 9-state contract progress tracker",
        "PnLBadge — USDC earned/spent with sparkline",
        "ReputationRing — circular score with dimension breakdown on hover",
      ],
    },
    layout_specs: {
      hero: "Full-width dark hero, animated agent DAG visualization, gradient CTA button",
      agent_grid: "3-column masonry grid of AgentCards, filterable by taxonomy",
      demo_section: "Split-screen: natural language input → live workflow execution",
      pricing_table: "Per-request vs subscription comparison with USDC amounts",
    },
    interaction_patterns: [
      "Instant search with taxonomy autocomplete (< 50ms)",
      "Hover on AgentCard reveals capability details and reputation dimensions",
      "Click 'Hire' opens contract drawer with SLA and escrow terms",
      "Live contract state transitions animate in real-time",
    ],
    mockup_summary: `Landing page for AI agent marketplace. Dark theme, code-aesthetic, electric blue accents. ${architecture?.sections?.length ?? 5} main sections.`,
  });
}

function frontendDeveloperHandler({ input, ctx }: AgentTask): Promise<unknown> {
  const { design_system, layout_specs } = input as {
    design_system: { colors: Record<string, string>; components: string[] };
    layout_specs: { hero: string };
  };
  ctx.log("Implementing React landing page from design specs");
  return Promise.resolve({
    implementation: {
      framework: "React 19 + TypeScript 5.5",
      bundler: "Vite 6 with code splitting",
      styling: "Tailwind CSS 4 + CSS custom properties for design tokens",
      animations: "Framer Motion for DAG visualization and contract transitions",
      state: "Zustand for agent registry + Tanstack Query for real-time contract polling",
      testing: "Vitest + React Testing Library, 94% component coverage",
    },
    files_created: [
      "src/components/AgentCard.tsx         — reputation ring, capabilities, hire CTA",
      "src/components/TaxonomyBrowser.tsx   — searchable tree with 61 agency-agents",
      "src/components/ContractTimeline.tsx  — animated 9-state machine visualizer",
      "src/components/WorkflowDAG.tsx       — live DAG with dependency arrows",
      "src/components/PnLBadge.tsx          — USDC earned sparkline widget",
      "src/pages/index.tsx                  — full landing page composition",
      "src/hooks/useRegistry.ts             — ServiceRegistry React adapter",
      "src/styles/tokens.css               — design system CSS variables",
    ],
    performance: {
      lcp: "1.2s (target: < 2.5s)",
      fid: "< 50ms",
      cls: "0.02 (target: < 0.1)",
      lighthouse_score: 97,
      bundle_size: "142kb gzipped (main chunk)",
      total_components: design_system?.components?.length ?? 5,
    },
    accessibility: "WCAG 2.1 AA — keyboard nav, screen reader tested, motion preferences respected",
    deployment: {
      ci_cd: "GitHub Actions → Vercel edge deployment",
      preview_url: "https://clawdia-marketplace-preview.vercel.app",
    },
  });
}

function brandGuardianHandler({ input, ctx }: AgentTask): Promise<unknown> {
  const { implementation } = input as { implementation: { framework: string } };
  ctx.log(`Auditing brand consistency across ${(implementation?.files_created as string[] | undefined)?.length ?? 8} files`);
  return Promise.resolve({
    brand_audit: {
      consistency_score: 94,
      issues_found: [
        { severity: "low", location: "AgentCard hover state", issue: "Border color should be --color-primary not hardcoded #58a6ff" },
        { severity: "low", location: "PnLBadge", issue: "USDC amount should use tabular numbers (font-variant-numeric: tabular-nums)" },
      ],
      issues_fixed: 2,
    },
    brand_guidelines: {
      voice: "Technical but approachable. Precise without being intimidating. Peer-to-peer, not top-down.",
      tone: "Confident in capability claims. Transparent on pricing. Nerdy in the good way.",
      messaging_hierarchy: [
        "Primary: 'The agent economy, wired for commerce'",
        "Secondary: 'Discover, hire, and pay specialist AI agents in one line of code'",
        "Tertiary: '61 specialists ready. More joining daily.'",
      ],
    },
    refinements_applied: [
      "Standardized all color references to CSS custom properties",
      "Added tabular numbers to all USDC amount displays",
      "Ensured Clawdia branding (clawmark icon, eagle motif) appears consistently",
      "Verified copy tone across all 6 page sections — brand voice consistent",
    ],
    final_verdict: "APPROVED — ready for production deployment",
  });
}

// ─── TaskContract driver ───────────────────────────────────────────────────────

async function runContract(opts: {
  contracts: ContractEngine;
  requester: AgentIdentity;
  provider: AgentIdentity;
  capability: string;
  input: Record<string, unknown>;
  paymentAmount: number;
  handler: (task: AgentTask) => Promise<unknown>;
  label: string;
}): Promise<unknown> {
  const { contracts, requester, provider, capability, input, paymentAmount, handler, label } = opts;
  const startMs = Date.now();

  const contract = contracts.create({
    requester,
    provider,
    capability,
    inputSchema: {},
    outputSchema: {},
    input,
    payment: { amount: paymentAmount, currency: "USDC" },
    sla: { deadlineMs: 120_000, maxRetries: 1 },
    verification: { method: "quality_score", minQualityScore: 0.75 },
  });

  // Drive through state machine
  await contracts.transition(contract.id, "OFFER", requester.name);
  await contracts.transition(contract.id, "ACCEPT", provider.name);
  await contracts.transition(contract.id, "FUND", requester.name);

  // Execute the handler (simulates provider doing the work)
  const mockTask: AgentTask = {
    input,
    contract,
    ctx: {
      log: (msg: string) => process.stdout.write(DIM(`      [${label}] ${msg}\n`)),
      contractId: contract.id,
      agentName: provider.name,
    },
  };

  const output = await handler(mockTask);
  contracts.setOutput(contract.id, output as Record<string, unknown>);

  await contracts.transition(contract.id, "DELIVER", provider.name);
  await contracts.transition(contract.id, "VERIFY", requester.name);
  await contracts.transition(contract.id, "SETTLE", requester.name);

  const durationMs = Date.now() - startMs;
  const c = contracts.get(contract.id);
  console.log(
    `    ${GREEN("✓")} ${label.padEnd(38)} ${DIM(`${durationMs}ms  $${paymentAmount.toFixed(2)} USDC  contract: ${contract.id.slice(0, 8)}`)}`
  );

  return output;
}

// ─── Main demo ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  banner("Clawdia × agency-agents Demo");

  const REQUEST = "Design and build a landing page for an AI agent marketplace";
  const BUDGET = 0.50;

  console.log(`  ${BOLD("Request:")} "${REQUEST}"`);
  console.log(`  ${BOLD("Budget:")}  ${BUDGET} USDC`);
  console.log(`  ${BOLD("Broker:")}  Clawdia — 15% orchestration margin\n`);

  // ── Boot infrastructure ──────────────────────────────────────────────────
  step(1, "Booting Clawdia infrastructure");

  const bus = new InMemoryBus();
  await bus.connect();
  const contracts = new ContractEngine(bus);
  const registry = new ServiceRegistry(bus);
  new ReputationEngine(bus);
  new InMemoryEscrow(bus);
  new BillingEngine(bus);

  console.log(`  ${GREEN("✓")} ClawBus (InMemory) connected`);
  console.log(`  ${GREEN("✓")} ContractEngine ready`);
  console.log(`  ${GREEN("✓")} ServiceRegistry ready`);

  // ── Register agency-agents ───────────────────────────────────────────────
  step(2, "Loading 61 agency-agents into ServiceRegistry");

  const result = registerAgencyAgents(registry);
  console.log(`  ${GREEN("✓")} Registered ${result.registered} specialist agents from agency-agents collection`);

  // Helper: find an agent by exact capability taxonomy
  function findAgent(taxonomy: string): AgentIdentity {
    const { entries } = registry.discover({ taxonomy, limit: 1 });
    const entry = entries[0];
    if (!entry) throw new Error(`No agent found for taxonomy: ${taxonomy}`);
    return entry.identity;
  }

  // ── Define Clawdia (broker) identity ─────────────────────────────────────
  const MOCK_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const clawdia: AgentIdentity = {
    name: "clawdia-broker",
    displayName: "Clawdia — Agent Services Broker",
    description: "The flagship orchestrator agent. Decomposes requests, discovers agents, hires them through contracts.",
    version: "1.0.0",
    operator: "clawdia-labs",
    publicKey: MOCK_KEY,
    capabilities: [{
      taxonomy: "orchestration.job.broker",
      description: "Full orchestration pipeline with 15% margin",
      inputSchema: {},
      outputSchema: {},
      sla: { maxLatencyMs: 300_000, availability: 0.99 },
      pricing: { model: "per_request", amount: 0.15, currency: "USDC" },
    }],
    requirements: [],
    runtime: { model: "claude-sonnet-4-6", memoryMb: 1024, cpus: 2, timeoutS: 300 },
    reputation: {
      registry: "clawdia-mainnet",
      score: 0.97,
      minimumStake: 50,
      dimensions: { reliability: 0.99, quality: 0.95, speed: 0.94, costEfficiency: 0.92 },
      attestations: [],
    },
  };

  // ── Agent discovery ──────────────────────────────────────────────────────
  step(3, "Clawdia discovers specialist agents");

  const uxResearcher = findAgent("design.ux.researcher");
  const uiDesigner = findAgent("design.ui.designer");
  const frontendDev = findAgent("coding.frontend.developer");
  const brandGuardian = findAgent("design.brand.guardian");

  const agentsNeeded = [
    { agent: uxResearcher, capability: "design.ux.researcher", role: "UX Research" },
    { agent: uiDesigner, capability: "design.ui.designer", role: "UI Design" },
    { agent: frontendDev, capability: "coding.frontend.developer", role: "Frontend Dev" },
    { agent: brandGuardian, capability: "design.brand.guardian", role: "Brand Audit" },
  ];

  for (const { agent, capability, role } of agentsNeeded) {
    const rep = (agent.reputation.score * 100).toFixed(0);
    const price = agent.capabilities[0]?.pricing.amount ?? 0;
    console.log(
      `  ${GREEN("✓")} ${role.padEnd(18)} → ${CYAN(agent.displayName.padEnd(24))} ` +
      `rep: ${rep}%  $${price}/req  taxonomy: ${DIM(capability)}`
    );
  }

  // ── Workflow DAG ──────────────────────────────────────────────────────────
  step(4, "Executing workflow DAG (4 sequential contracts)");

  console.log(`\n  ${MAGENTA("DAG:")} st-1 → st-2 → st-3 → st-4 (sequential dependencies)\n`);

  const totalStart = Date.now();

  // st-1: UX Research
  const uxOutput = await runContract({
    contracts,
    requester: clawdia,
    provider: uxResearcher,
    capability: "design.ux.researcher",
    input: {
      project: "AI agent marketplace",
      goals: ["Understand user needs", "Define information architecture", "Identify key flows"],
    },
    paymentAmount: 0.01,
    handler: uxResearcherHandler,
    label: "st-1  UX Research",
  });

  // st-2: UI Design (depends on st-1 output)
  const uxData = uxOutput as { information_architecture: { sections: string[] }; user_personas: unknown[] };
  const uiOutput = await runContract({
    contracts,
    requester: clawdia,
    provider: uiDesigner,
    capability: "design.ui.designer",
    input: {
      architecture: uxData.information_architecture,
      personas: uxData.user_personas,
      brand: { name: "Clawdia", tagline: "The agent economy, wired for commerce" },
    },
    paymentAmount: 0.01,
    handler: uiDesignerHandler,
    label: "st-2  UI Design",
  });

  // st-3: Frontend Implementation (depends on st-2 output)
  const uiData = uiOutput as { design_system: unknown; layout_specs: unknown; components: unknown };
  const frontendOutput = await runContract({
    contracts,
    requester: clawdia,
    provider: frontendDev,
    capability: "coding.frontend.developer",
    input: {
      design_system: uiData.design_system,
      layout_specs: uiData.layout_specs,
      framework: "React",
      deploy_target: "Vercel",
    },
    paymentAmount: 0.05,
    handler: frontendDeveloperHandler,
    label: "st-3  Frontend Dev",
  });

  // st-4: Brand Audit (depends on st-3 output)
  const frontendData = frontendOutput as { implementation: unknown; files_created: unknown };
  await runContract({
    contracts,
    requester: clawdia,
    provider: brandGuardian,
    capability: "design.brand.guardian",
    input: {
      implementation: frontendData.implementation,
      files_created: frontendData.files_created,
      brand_guidelines_url: "https://clawdia.dev/brand",
    },
    paymentAmount: 0.01,
    handler: brandGuardianHandler,
    label: "st-4  Brand Audit",
  });

  const totalDurationMs = Date.now() - totalStart;

  // ── P&L Report ────────────────────────────────────────────────────────────
  step(5, "P&L — Broker margin and cost breakdown");

  const subtaskCost = 0.01 + 0.01 + 0.05 + 0.01;
  const orchestrationMargin = subtaskCost * 0.15;
  const totalCharged = subtaskCost + orchestrationMargin;

  const contractStats = contracts.stats() as Record<string, number>;
  const settled = contractStats["settled"] ?? 0;

  console.log(`\n  ${"Agent".padEnd(32)} ${"Capability".padEnd(34)} ${"Cost"}`);
  console.log("  " + "─".repeat(72));
  console.log(`  ${uxResearcher.displayName.padEnd(32)} ${"design.ux.researcher".padEnd(34)} $0.01 USDC`);
  console.log(`  ${uiDesigner.displayName.padEnd(32)} ${"design.ui.designer".padEnd(34)} $0.01 USDC`);
  console.log(`  ${frontendDev.displayName.padEnd(32)} ${"coding.frontend.developer".padEnd(34)} $0.05 USDC`);
  console.log(`  ${brandGuardian.displayName.padEnd(32)} ${"design.brand.guardian".padEnd(34)} $0.01 USDC`);
  console.log("  " + "─".repeat(72));
  console.log(`  ${"Subtask costs".padEnd(66)} $${subtaskCost.toFixed(4)} USDC`);
  console.log(`  ${`Clawdia margin (15%)`.padEnd(66)} $${orchestrationMargin.toFixed(4)} USDC`);
  console.log(`  ${BOLD("Total charged to client").padEnd(66)} ${BOLD(`$${totalCharged.toFixed(4)} USDC`)}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  banner("Results");

  console.log(`  ${BOLD("Status")}        completed`);
  console.log(`  ${BOLD("Steps")}         4/4 contracts settled`);
  console.log(`  ${BOLD("Duration")}      ${totalDurationMs}ms`);
  console.log(`  ${BOLD("Quality")}       94% (brand audit score)`);
  console.log(`  ${BOLD("Total cost")}    $${totalCharged.toFixed(4)} USDC`);
  console.log(`  ${BOLD("Broker margin")} $${orchestrationMargin.toFixed(4)} USDC (15%)\n`);

  console.log(`  ${BOLD("Deliverables produced:")}`);
  console.log(`  • UX research report — 3 personas, 2 key flows, 4 insights`);
  console.log(`  • UI design system — color palette, typography, 5 components`);
  console.log(`  • React implementation — 8 components, Lighthouse 97, WCAG 2.1 AA`);
  console.log(`  • Brand audit — 94% consistency, 2 issues fixed\n`);

  console.log(`  ${CYAN("Registry stats:")}`);
  const stats = registry.stats() as Record<string, number>;
  console.log(`  • Online agents: ${stats["online"] ?? 0}`);
  console.log(`  • Total contracts settled: ${settled}\n`);

  console.log(`  ${YELLOW("Next steps:")}`);
  console.log(`  • Run the full broker:   ${DIM("npx tsx examples/orchestrator-agent/broker.ts")}`);
  console.log(`  • Start the daemon:      ${DIM("npx tsx packages/orchestrator/src/daemon.ts")}`);
  console.log(`  • Import more agents:    ${DIM("npx tsx scripts/import-agency-agents.ts")}\n`);

  await bus.disconnect();
}

main().catch((err: unknown) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
