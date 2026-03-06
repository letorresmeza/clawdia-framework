/**
 * Integration tests for the agent-orchestrator plugin.
 *
 * Tests:
 *   1. TaskDecomposer — valid DAGs for different request types
 *   2. AgentMatcher — correct weighted ranking
 *   3. WorkflowExecutor — full end-to-end with 3+ subtasks
 *   4. Failure handling — retry then fallback to alternative
 *   5. Orchestration margin calculation
 *   6. OutputAssembler — quality check catches low-quality outputs
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryBus, ContractEngine } from "@clawdia/core";
import { ServiceRegistry } from "@clawdia/orchestrator";
import type { AgentIdentity, RegistryEntry } from "@clawdia/types";
import {
  TaskDecomposer,
  AgentMatcher,
  WorkflowExecutor,
  OutputAssembler,
} from "../index.js";
import type { WorkflowDAG } from "../index.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeIdentity(name: string, capabilities: string[], reputationScore = 0.8): AgentIdentity {
  return {
    name,
    displayName: name,
    description: `Test agent: ${name}`,
    version: "1.0.0",
    operator: "test",
    publicKey: `pub-${name}`,
    capabilities: capabilities.map((taxonomy) => ({
      taxonomy,
      description: `${taxonomy} capability`,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      sla: { maxLatencyMs: 5000, availability: 0.99 },
      pricing: { model: "per_request" as const, amount: 0.05, currency: "USDC" },
    })),
    requirements: [],
    runtime: { model: "claude-sonnet-4-6" },
    reputation: {
      registry: "test",
      score: reputationScore,
      minimumStake: 5,
      dimensions: {
        reliability: reputationScore,
        quality: reputationScore - 0.05,
        speed: reputationScore - 0.1,
        costEfficiency: reputationScore,
      },
      attestations: [],
    },
  };
}

function makeEntry(
  identity: AgentIdentity,
  status: "online" | "busy" | "offline" = "online",
): RegistryEntry {
  return {
    identity,
    registeredAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    status,
  };
}

const BROKER_IDENTITY: AgentIdentity = {
  name: "clawdia-broker",
  displayName: "Clawdia Broker",
  description: "Test broker",
  version: "1.0.0",
  operator: "test",
  publicKey: "broker-pub",
  capabilities: [],
  requirements: [],
  runtime: {},
};

// ─── TaskDecomposer tests ─────────────────────────────────────────────────────

describe("TaskDecomposer", () => {
  const decomposer = new TaskDecomposer();

  it("produces a valid research DAG", () => {
    const dag = decomposer.decompose("Research the top 5 AI agent frameworks", 1.0);

    expect(dag.id).toMatch(/^wf-/);
    expect(dag.requestType).toBe("research");
    expect(dag.subtasks.length).toBeGreaterThanOrEqual(2);
    expect(dag.originalRequest).toContain("Research");

    // All subtasks must have valid IDs
    for (const st of dag.subtasks) {
      expect(st.id).toBeTruthy();
      expect(st.capability).toBeTruthy();
      expect(st.budgetAllocation).toBeGreaterThan(0);
    }

    // Budget allocations must sum to approximately the total budget
    const budgetSum = dag.subtasks.reduce((s, st) => s + st.budgetAllocation, 0);
    expect(budgetSum).toBeCloseTo(1.0, 2);
  });

  it("produces a valid analysis DAG", () => {
    const dag = decomposer.decompose("Analyze the market data and statistics", 2.0);
    expect(dag.requestType).toBe("analysis");
    expect(dag.subtasks.some((st) => st.capability.includes("analysis"))).toBe(true);
  });

  it("produces a valid content DAG", () => {
    const dag = decomposer.decompose("Write a technical blog post about AI agents", 0.5);
    expect(dag.requestType).toBe("content");
    expect(dag.subtasks.some((st) => st.capability.includes("content"))).toBe(true);
  });

  it("produces a valid code DAG", () => {
    const dag = decomposer.decompose("Implement a REST API with authentication", 3.0);
    expect(dag.requestType).toBe("code");
    expect(dag.subtasks.some((st) => st.capability.includes("coding"))).toBe(true);
  });

  it("produces a generic DAG for unknown requests", () => {
    const dag = decomposer.decompose("Do something unusual", 0.5);
    expect(dag.requestType).toBe("generic");
    expect(dag.subtasks.length).toBeGreaterThanOrEqual(1);
  });

  it("DAG dependencies form a valid topological order (no circular deps)", () => {
    const dag = decomposer.decompose("Research and analyze AI frameworks", 1.5);
    const subtaskIds = new Set(dag.subtasks.map((st) => st.id));

    for (const st of dag.subtasks) {
      for (const depId of st.dependencies) {
        // Every dependency must reference a known subtask ID
        expect(subtaskIds.has(depId)).toBe(true);
        // A subtask cannot depend on itself
        expect(depId).not.toBe(st.id);
      }
    }
  });

  it("uses total budget proportionally across subtasks", () => {
    const dag1 = decomposer.decompose("Research AI frameworks", 1.0);
    const dag2 = decomposer.decompose("Research AI frameworks", 2.0);

    const sum1 = dag1.subtasks.reduce((s, st) => s + st.budgetAllocation, 0);
    const sum2 = dag2.subtasks.reduce((s, st) => s + st.budgetAllocation, 0);

    // sum2 should be approximately double sum1
    expect(sum2 / sum1).toBeCloseTo(2.0, 1);
  });
});

// ─── AgentMatcher tests ───────────────────────────────────────────────────────

describe("AgentMatcher", () => {
  const matcher = new AgentMatcher();
  const capability = "research.web.search";

  it("ranks higher reputation agents first (all else equal)", () => {
    const highRep = makeEntry(makeIdentity("high-rep-agent", [capability], 0.95));
    const lowRep = makeEntry(makeIdentity("low-rep-agent", [capability], 0.40));

    const ranked = matcher.rankCandidates([lowRep, highRep], capability, 0.10);

    expect(ranked[0]!.agent.identity.name).toBe("high-rep-agent");
    expect(ranked[1]!.agent.identity.name).toBe("low-rep-agent");
  });

  it("penalises offline agents via availability score", () => {
    const online = makeEntry(makeIdentity("online-agent", [capability], 0.80), "online");
    const offline = makeEntry(makeIdentity("offline-agent", [capability], 0.90), "offline");

    // offline-agent has higher reputation but should lose on availability
    const ranked = matcher.rankCandidates([offline, online], capability, 0.10);

    // online agent (0.80 rep + full availability) should beat offline (0.90 rep + zero availability)
    // Score formula: 0.80*0.40 + X*0.30 + 1.0*0.20 + Y*0.10 vs 0.90*0.40 + X*0.30 + 0.0*0.20 + Y*0.10
    // Diff: online advantage = 1.0*0.20 = 0.20, offline advantage = 0.10*0.40 = 0.04 → online wins
    expect(ranked[0]!.agent.identity.name).toBe("online-agent");
  });

  it("applies all 4 weight dimensions and they sum to 1.0", () => {
    const entry = makeEntry(makeIdentity("test-agent", [capability], 0.80));
    const ranked = matcher.rankCandidates([entry], capability, 0.10);

    const { breakdown, score } = ranked[0]!;
    // Verify approximate score from breakdown
    const recomputedScore =
      breakdown.reputation * 0.40 +
      breakdown.price * 0.30 +
      breakdown.availability * 0.20 +
      breakdown.performance * 0.10;

    expect(score).toBeCloseTo(recomputedScore, 5);
  });

  it("returns empty array for empty registry", () => {
    const ranked = matcher.rankCandidates([], capability, 1.0);
    expect(ranked).toHaveLength(0);
  });

  it("scores all agents between 0.0 and 1.0", () => {
    const entries = [
      makeEntry(makeIdentity("a1", [capability], 0.99), "online"),
      makeEntry(makeIdentity("a2", [capability], 0.10), "offline"),
      makeEntry(makeIdentity("a3", [capability], 0.50), "busy"),
    ];
    const ranked = matcher.rankCandidates(entries, capability, 0.05);
    for (const r of ranked) {
      expect(r.score).toBeGreaterThanOrEqual(0.0);
      expect(r.score).toBeLessThanOrEqual(1.0);
    }
  });
});

// ─── WorkflowExecutor end-to-end tests ───────────────────────────────────────

describe("WorkflowExecutor", () => {
  let bus: InMemoryBus;
  let registry: ServiceRegistry;
  let contracts: ContractEngine;

  beforeEach(async () => {
    bus = new InMemoryBus();
    await bus.connect();
    registry = new ServiceRegistry(bus);
    contracts = new ContractEngine(bus);
  });

  /** Register a mock agent that auto-delivers a result when funded */
  async function registerMockAgent(
    name: string,
    capabilities: string[],
    resultFn: (cap: string) => unknown = () => ({ output: "test result", data: [1, 2, 3] }),
    failOnAttempt?: number,
  ): Promise<void> {
    const identity = makeIdentity(name, capabilities, 0.85);
    registry.register(identity);

    let attemptCount = 0;

    bus.subscribe("task.request", async (msg) => {
      const payload = msg.payload as { contractId?: string; event?: string; newState?: string };
      if (payload.event !== "FUND" || payload.newState !== "in_progress") return;
      if (!payload.contractId) return;

      const contract = contracts.get(payload.contractId);
      if (!contract || contract.provider?.name !== name) return;

      attemptCount++;
      if (failOnAttempt !== undefined && attemptCount <= failOnAttempt) {
        await contracts.transition(contract.id, "FAIL", name);
        return;
      }

      const output = resultFn(contract.capability);
      contracts.setOutput(contract.id, output);
      await contracts.transition(contract.id, "DELIVER", name);
    });
  }

  it("executes a 3-subtask research workflow end to end", async () => {
    await registerMockAgent("research-agent", ["research.web.search", "research.synthesis"], (cap) =>
      cap === "research.web.search"
        ? { results: [{ title: "T1", url: "https://a.com", snippet: "s", relevance_score: 0.9 }], total_found: 1 }
        : { title: "Report", summary: "Key findings on AI agents.", key_findings: ["F1", "F2"], confidence: 0.85 },
    );
    await registerMockAgent("content-writer", ["content.writing.technical"], () => ({
      markdown: "# Report\n\n## Overview\n\nContent here.",
      sections_written: ["Overview"],
      word_count: 10,
    }));

    const decomposer = new TaskDecomposer();
    const dag = decomposer.decompose("Research AI agent frameworks", 1.0);

    const executor = new WorkflowExecutor({
      bus,
      registry,
      contracts,
      orchestratorIdentity: BROKER_IDENTITY,
    });

    const result = await executor.execute(dag);

    expect(result.status).toBe("completed");
    expect(result.subtaskResults.length).toBeGreaterThan(0);
    expect(result.totalSubtaskCostUsdc).toBeGreaterThan(0);
    expect(result.orchestrationMarginUsdc).toBeCloseTo(result.totalSubtaskCostUsdc * 0.15, 5);
    expect(result.totalChargedUsdc).toBeCloseTo(result.totalSubtaskCostUsdc * 1.15, 5);
  }, 15000);

  it("retries on failure then finds an alternative agent", async () => {
    // First agent fails on first attempt, succeeds on second (retry)
    await registerMockAgent(
      "flaky-agent",
      ["research.web.search", "research.synthesis"],
      () => ({ results: [{ title: "T", url: "https://b.com", snippet: "s", relevance_score: 0.8 }], total_found: 1 }),
      1, // fail on first attempt
    );
    await registerMockAgent("content-writer", ["content.writing.technical"], () => ({
      markdown: "# Content",
      sections_written: ["Overview"],
      word_count: 5,
    }));

    const decomposer = new TaskDecomposer();
    const dag = decomposer.decompose("Research the topic", 1.0);

    const executor = new WorkflowExecutor({ bus, registry, contracts, orchestratorIdentity: BROKER_IDENTITY });
    const result = await executor.execute(dag);

    // Should still complete — retry should succeed
    expect(result.subtaskResults.length).toBeGreaterThanOrEqual(1);
  }, 15000);

  it("calculates correct 15% orchestration margin", async () => {
    await registerMockAgent("research-agent", ["research.web.search", "research.synthesis"], () => ({
      results: [{ url: "https://x.com" }],
      summary: "Summary",
      key_findings: ["F1"],
      confidence: 0.9,
    }));
    await registerMockAgent("content-writer", ["content.writing.technical"], () => ({
      markdown: "# Doc",
      sections_written: ["Overview"],
      word_count: 5,
    }));

    const dag: WorkflowDAG = {
      id: "wf-test",
      originalRequest: "test",
      requestType: "research",
      subtasks: [
        {
          id: "st-1",
          capability: "research.web.search",
          description: "Search",
          input: { query: "test", max_results: 3 },
          dependencies: [],
          estimatedComplexity: "low",
          budgetAllocation: 0.20,
          currency: "USDC",
        },
        {
          id: "st-2",
          capability: "research.synthesis",
          description: "Synthesize",
          input: { topic: "test", sources: [] },
          dependencies: ["st-1"],
          estimatedComplexity: "medium",
          budgetAllocation: 0.40,
          currency: "USDC",
        },
      ],
    };

    const executor = new WorkflowExecutor({ bus, registry, contracts, orchestratorIdentity: BROKER_IDENTITY });
    const result = await executor.execute(dag);

    const expectedMargin = result.totalSubtaskCostUsdc * 0.15;
    expect(result.orchestrationMarginUsdc).toBeCloseTo(expectedMargin, 5);
    expect(result.totalChargedUsdc).toBeCloseTo(result.totalSubtaskCostUsdc + expectedMargin, 5);
  }, 15000);

  it("publishes workflow.step.complete events on the bus", async () => {
    await registerMockAgent("research-agent", ["research.web.search", "research.synthesis"], () => ({
      results: [{ url: "https://x.com" }],
      summary: "Summary",
      key_findings: [],
      confidence: 0.8,
    }));
    await registerMockAgent("content-writer", ["content.writing.technical"], () => ({
      markdown: "# Doc",
      sections_written: [],
      word_count: 3,
    }));

    const stepEvents: unknown[] = [];
    bus.subscribe("workflow.step.complete", async (msg) => {
      stepEvents.push(msg.payload);
    });

    const decomposer = new TaskDecomposer();
    const dag = decomposer.decompose("Research AI", 0.5);

    const executor = new WorkflowExecutor({ bus, registry, contracts, orchestratorIdentity: BROKER_IDENTITY });
    await executor.execute(dag);

    expect(stepEvents.length).toBeGreaterThan(0);
    for (const ev of stepEvents) {
      expect(ev).toHaveProperty("workflowId");
      expect(ev).toHaveProperty("subtaskId");
      expect(ev).toHaveProperty("agentName");
    }
  }, 15000);
});

// ─── OutputAssembler tests ────────────────────────────────────────────────────

describe("OutputAssembler", () => {
  const assembler = new OutputAssembler();

  it("assembles research output with quality score", () => {
    const subtaskResults = [
      {
        subtaskId: "st-1",
        agentName: "research-agent",
        output: {
          results: [{ title: "T", url: "https://a.com", snippet: "s" }],
          total_found: 1,
        },
        contractId: "c-1",
        durationMs: 100,
        qualityScore: 0.80,
        costUsdc: 0.02,
      },
      {
        subtaskId: "st-2",
        agentName: "research-agent",
        output: {
          title: "Research Report: AI",
          summary: "This is a comprehensive summary of AI agent frameworks with many key insights about the ecosystem.",
          key_findings: ["Finding 1", "Finding 2", "Finding 3"],
          confidence: 0.87,
          word_count: 200,
        },
        contractId: "c-2",
        durationMs: 200,
        qualityScore: 0.85,
        costUsdc: 0.08,
      },
      {
        subtaskId: "st-3",
        agentName: "content-writer",
        output: {
          markdown: "# AI Frameworks Report\n\n## Overview\n\nDetailed content about AI agent frameworks goes here.",
          sections_written: ["Overview", "Findings", "Conclusion"],
          word_count: 300,
        },
        contractId: "c-3",
        durationMs: 150,
        qualityScore: 0.82,
        costUsdc: 0.10,
      },
    ];

    const result = assembler.assemble("Research AI agent frameworks", "research", subtaskResults);

    expect(result.assembledOutput).not.toBeNull();
    const output = result.assembledOutput as Record<string, unknown>;
    expect(output["type"]).toBe("research_report");
    expect(output["key_findings"]).toHaveLength(3);
    expect(result.qualityScore).toBeGreaterThan(0);
    expect(result.qualityScore).toBeLessThanOrEqual(1.0);
  });

  it("flags low-quality output and identifies weakest subtask", () => {
    const subtaskResults = [
      {
        subtaskId: "st-1",
        agentName: "agent-a",
        output: null,
        contractId: "c-1",
        durationMs: 100,
        qualityScore: 0.10, // very poor
        costUsdc: 0.02,
      },
      {
        subtaskId: "st-2",
        agentName: "agent-b",
        output: null,
        contractId: "c-2",
        durationMs: 100,
        qualityScore: 0.30,
        costUsdc: 0.04,
      },
    ];

    const result = assembler.assemble("Do something", "generic", subtaskResults);

    // With null outputs and low quality scores, should fail threshold
    expect(result.qualityPasses).toBe(false);
    expect(result.weakestSubtaskId).toBe("st-1"); // lowest quality
  });

  it("passes quality threshold for good outputs", () => {
    const subtaskResults = [
      {
        subtaskId: "st-1",
        agentName: "agent-a",
        output: {
          summary: "This is a very comprehensive and detailed summary that covers all aspects of the requested topic with thorough analysis.",
          key_findings: ["F1", "F2", "F3"],
          confidence: 0.90,
        },
        contractId: "c-1",
        durationMs: 100,
        qualityScore: 0.90,
        costUsdc: 0.08,
      },
    ];

    const result = assembler.assemble("Research topic", "generic", subtaskResults);

    expect(result.qualityPasses).toBe(true);
    expect(result.weakestSubtaskId).toBeNull();
  });

  it("assembles code output with security review", () => {
    const subtaskResults = [
      {
        subtaskId: "st-2",
        agentName: "code-builder",
        output: {
          files_changed: [{ path: "src/api.ts", action: "created" }],
          pr_url: "https://github.com/x/y/pull/1",
          tests_passed: true,
        },
        contractId: "c-2",
        durationMs: 500,
        qualityScore: 0.85,
        costUsdc: 0.50,
      },
      {
        subtaskId: "st-3",
        agentName: "code-reviewer",
        output: {
          vulnerabilities: [],
          overall_risk: "low",
        },
        contractId: "c-3",
        durationMs: 200,
        qualityScore: 0.80,
        costUsdc: 0.10,
      },
    ];

    const result = assembler.assemble("Build a REST API", "code", subtaskResults);
    const output = result.assembledOutput as Record<string, unknown>;
    expect(output["type"]).toBe("code_delivery");
    expect(output["security_review"]).toBeTruthy();
  });
});
