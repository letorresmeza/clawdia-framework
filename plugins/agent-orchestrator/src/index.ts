/**
 * agent-orchestrator — Clawdia Broker Plugin
 *
 * Implements IAgentAdapter with full orchestration logic:
 *   TaskDecomposer  → pattern-match request → DAG of subtasks
 *   AgentMatcher    → weighted scoring to find best specialist per subtask
 *   WorkflowExecutor → execute DAG respecting dependencies, with retry/fallback
 *   OutputAssembler → merge subtask outputs, quality-score the result
 *   OrchestratorAgent → wires all the above; calculates P&L with 15% margin
 */

import { v7 as uuid } from "uuid";
import type {
  IAgentAdapter,
  AgentConfig,
  TaskPayload,
  TaskResult,
  TaskChunk,
  AgentStatus,
  PluginModule,
  AgentIdentity,
} from "@clawdia/types";
import type { RegistryEntry } from "@clawdia/types";
import type { IClawBus } from "@clawdia/core";
import type { ServiceRegistry } from "@clawdia/orchestrator";
import type { ContractEngine } from "@clawdia/core";

// ─────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────

export interface Subtask {
  id: string;
  capability: string;
  description: string;
  input: Record<string, unknown>;
  /** IDs of subtasks that must complete before this one starts */
  dependencies: string[];
  estimatedComplexity: "low" | "medium" | "high";
  budgetAllocation: number;
  currency: string;
}

export type WorkflowRequestType = "research" | "analysis" | "content" | "code" | "generic";

export interface WorkflowDAG {
  id: string;
  originalRequest: string;
  requestType: WorkflowRequestType;
  subtasks: Subtask[];
}

export interface CandidateScore {
  agent: RegistryEntry;
  /** Composite score 0.0–1.0 */
  score: number;
  breakdown: {
    reputation: number;
    price: number;
    availability: number;
    performance: number;
  };
}

export interface SubtaskResult {
  subtaskId: string;
  agentName: string;
  output: unknown;
  contractId: string;
  durationMs: number;
  qualityScore: number;
  costUsdc: number;
}

export interface WorkflowResult {
  workflowId: string;
  status: "completed" | "degraded" | "failed";
  subtaskResults: SubtaskResult[];
  assembledOutput: unknown;
  qualityScore: number;
  totalSubtaskCostUsdc: number;
  orchestrationMarginUsdc: number;
  totalChargedUsdc: number;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────
// TaskDecomposer
// ─────────────────────────────────────────────────────────

export class TaskDecomposer {
  /**
   * Decompose a natural language request into a DAG of subtasks.
   * TODO: Replace pattern matching with LLM-based decomposition for
   * dynamic, context-aware task planning.
   */
  decompose(request: string, totalBudget: number): WorkflowDAG {
    const id = `wf-${uuid()}`;
    const lower = request.toLowerCase();
    const requestType = this.classifyRequest(lower);
    const subtasks = this.buildSubtasks(request, requestType, totalBudget);
    return { id, originalRequest: request, requestType, subtasks };
  }

  private classifyRequest(lower: string): WorkflowRequestType {
    if (lower.includes("research") || lower.includes("survey") || lower.includes("find") || lower.includes("compare")) {
      return "research";
    }
    if (lower.includes("analyz") || lower.includes("data") || lower.includes("metrics") || lower.includes("statistics")) {
      return "analysis";
    }
    if (lower.includes("write") || lower.includes("content") || lower.includes("blog") || lower.includes("article") || lower.includes("report")) {
      return "content";
    }
    if (lower.includes("code") || lower.includes("implement") || lower.includes("build") || lower.includes("develop") || lower.includes("fix")) {
      return "code";
    }
    return "generic";
  }

  private buildSubtasks(
    request: string,
    type: WorkflowRequestType,
    totalBudget: number,
  ): Subtask[] {
    // TODO: Replace with LLM decomposer that reads registry capabilities
    // and generates a custom DAG for any request type.

    switch (type) {
      case "research":
        return [
          {
            id: "st-1",
            capability: "research.web.search",
            description: "Search for relevant information on the topic",
            input: { query: request, max_results: 10 },
            dependencies: [],
            estimatedComplexity: "low",
            budgetAllocation: totalBudget * 0.20,
            currency: "USDC",
          },
          {
            id: "st-2",
            capability: "research.synthesis",
            description: "Synthesize search results into structured findings",
            input: {
              topic: request,
              sources: [],  // filled at runtime from st-1 output
              output_format: "report",
            },
            dependencies: ["st-1"],
            estimatedComplexity: "medium",
            budgetAllocation: totalBudget * 0.40,
            currency: "USDC",
          },
          {
            id: "st-3",
            capability: "content.writing.technical",
            description: "Format and polish the final deliverable",
            input: {
              subject: request,
              doc_type: "report",
              audience_level: "intermediate",
              sections: ["Overview", "Key Findings", "Comparison", "Conclusion"],
            },
            dependencies: ["st-2"],
            estimatedComplexity: "medium",
            budgetAllocation: totalBudget * 0.40,
            currency: "USDC",
          },
        ];

      case "analysis":
        return [
          {
            id: "st-1",
            capability: "research.web.search",
            description: "Gather data sources and background information",
            input: { query: request, max_results: 10 },
            dependencies: [],
            estimatedComplexity: "low",
            budgetAllocation: totalBudget * 0.25,
            currency: "USDC",
          },
          {
            id: "st-2",
            capability: "analysis.data.csv",
            description: "Perform statistical analysis on collected data",
            input: {
              csv_data: "",  // filled at runtime
              operations: ["describe", "trend", "correlate"],
            },
            dependencies: ["st-1"],
            estimatedComplexity: "high",
            budgetAllocation: totalBudget * 0.50,
            currency: "USDC",
          },
          {
            id: "st-3",
            capability: "content.writing.technical",
            description: "Write the analysis report with findings",
            input: {
              subject: request,
              doc_type: "report",
              audience_level: "intermediate",
              sections: ["Summary", "Methodology", "Findings", "Recommendations"],
            },
            dependencies: ["st-2"],
            estimatedComplexity: "medium",
            budgetAllocation: totalBudget * 0.25,
            currency: "USDC",
          },
        ];

      case "content":
        return [
          {
            id: "st-1",
            capability: "research.web.search",
            description: "Research background information for the content",
            input: { query: request, max_results: 5 },
            dependencies: [],
            estimatedComplexity: "low",
            budgetAllocation: totalBudget * 0.20,
            currency: "USDC",
          },
          {
            id: "st-2",
            capability: "content.writing.technical",
            description: "Write the primary content",
            input: {
              subject: request,
              doc_type: "article",
              audience_level: "intermediate",
              sections: ["Introduction", "Main Content", "Conclusion"],
            },
            dependencies: ["st-1"],
            estimatedComplexity: "medium",
            budgetAllocation: totalBudget * 0.80,
            currency: "USDC",
          },
        ];

      case "code":
        return [
          {
            id: "st-1",
            capability: "research.web.search",
            description: "Research existing solutions and patterns",
            input: { query: request, max_results: 5 },
            dependencies: [],
            estimatedComplexity: "low",
            budgetAllocation: totalBudget * 0.15,
            currency: "USDC",
          },
          {
            id: "st-2",
            capability: "coding.implementation.fullstack",
            description: "Implement the requested code",
            input: { issue_description: request },
            dependencies: ["st-1"],
            estimatedComplexity: "high",
            budgetAllocation: totalBudget * 0.65,
            currency: "USDC",
          },
          {
            id: "st-3",
            capability: "coding.review.security",
            description: "Review the implementation for issues",
            input: { pr_url: "", focus_areas: ["security", "correctness", "performance"] },
            dependencies: ["st-2"],
            estimatedComplexity: "medium",
            budgetAllocation: totalBudget * 0.20,
            currency: "USDC",
          },
        ];

      default:
        return [
          {
            id: "st-1",
            capability: "research.web.search",
            description: "Research the topic",
            input: { query: request, max_results: 10 },
            dependencies: [],
            estimatedComplexity: "medium",
            budgetAllocation: totalBudget * 0.40,
            currency: "USDC",
          },
          {
            id: "st-2",
            capability: "research.synthesis",
            description: "Synthesize findings into a response",
            input: { topic: request, sources: [], output_format: "report" },
            dependencies: ["st-1"],
            estimatedComplexity: "medium",
            budgetAllocation: totalBudget * 0.60,
            currency: "USDC",
          },
        ];
    }
  }
}

// ─────────────────────────────────────────────────────────
// AgentMatcher
// ─────────────────────────────────────────────────────────

/**
 * Ranks registry entries for a given capability using a weighted formula:
 *   Reputation   40%  — overall reputation score (0.0–1.0)
 *   Price        30%  — cheaper relative to budget = higher score
 *   Availability 20%  — online=1.0, busy=0.5, offline=0.0
 *   Performance  10%  — quality dimension from reputation snapshot
 */
export class AgentMatcher {
  private static readonly WEIGHTS = {
    reputation: 0.40,
    price: 0.30,
    availability: 0.20,
    performance: 0.10,
  } as const;

  rankCandidates(
    entries: RegistryEntry[],
    capability: string,
    budgetUsdc: number,
  ): CandidateScore[] {
    return entries
      .map((entry) => this.scoreEntry(entry, capability, budgetUsdc))
      .sort((a, b) => b.score - a.score);
  }

  private scoreEntry(
    entry: RegistryEntry,
    capability: string,
    budgetUsdc: number,
  ): CandidateScore {
    const cap = entry.identity.capabilities.find((c) => c.taxonomy === capability);
    const price = cap?.pricing.amount ?? budgetUsdc;
    const reputation = entry.identity.reputation?.score ?? 0.5;

    // Reputation: raw score directly
    const reputationScore = Math.min(1.0, Math.max(0.0, reputation));

    // Price: cheaper is better. Normalise so price=0 → 1.0, price=budget → 0.5, price>budget → lower.
    const priceScore =
      budgetUsdc > 0
        ? Math.max(0.0, 1.0 - (price / budgetUsdc) * 0.5)
        : price === 0
          ? 1.0
          : 0.5;

    // Availability
    const availabilityScore =
      entry.status === "online" ? 1.0 : entry.status === "busy" ? 0.5 : 0.0;

    // Performance: use quality dimension from reputation snapshot if available
    const performanceScore =
      entry.identity.reputation?.dimensions?.quality ?? 0.5;

    const score =
      reputationScore * AgentMatcher.WEIGHTS.reputation +
      priceScore * AgentMatcher.WEIGHTS.price +
      availabilityScore * AgentMatcher.WEIGHTS.availability +
      performanceScore * AgentMatcher.WEIGHTS.performance;

    return {
      agent: entry,
      score,
      breakdown: {
        reputation: reputationScore,
        price: priceScore,
        availability: availabilityScore,
        performance: performanceScore,
      },
    };
  }
}

// ─────────────────────────────────────────────────────────
// WorkflowExecutor
// ─────────────────────────────────────────────────────────

export interface WorkflowExecutorServices {
  bus: IClawBus;
  registry: ServiceRegistry;
  contracts: ContractEngine;
  orchestratorIdentity: AgentIdentity;
}

/**
 * Executes a WorkflowDAG respecting subtask dependencies.
 *
 * For each subtask:
 *   1. Find best agent via AgentMatcher
 *   2. Create TaskContract, fund escrow, dispatch via bus
 *   3. Wait for DELIVER event (or timeout)
 *   4. On failure: retry with same agent once, then try next candidate
 *   5. If all candidates fail: mark workflow degraded, escalate to human
 *
 * Publishes workflow.step.complete after each successful subtask.
 */
export class WorkflowExecutor {
  private readonly matcher = new AgentMatcher();
  private readonly ORCHESTRATION_MARGIN = 0.15;

  constructor(private readonly services: WorkflowExecutorServices) {}

  async execute(dag: WorkflowDAG): Promise<WorkflowResult> {
    const startMs = Date.now();
    const completed = new Map<string, SubtaskResult>();
    let workflowStatus: WorkflowResult["status"] = "completed";

    // Topological execution: process subtasks in dependency order
    const remaining = [...dag.subtasks];
    let maxIterations = dag.subtasks.length * 2; // prevent infinite loops

    while (remaining.length > 0 && maxIterations-- > 0) {
      // Find subtasks whose dependencies are all completed
      const ready = remaining.filter((st) =>
        st.dependencies.every((depId) => completed.has(depId)),
      );

      if (ready.length === 0) {
        // Circular dependency or dead-end — shouldn't happen with valid DAGs
        workflowStatus = "failed";
        break;
      }

      // Execute ready subtasks (in this implementation: sequentially for clarity;
      // a future version could parallelise independent branches)
      for (const subtask of ready) {
        // Propagate outputs from dependencies into input
        const enrichedInput = this.enrichInput(subtask, completed);

        const result = await this.executeSubtask(subtask, enrichedInput, dag.id);

        if (result === null) {
          // All retries exhausted
          await this.escalateToHuman(dag.id, subtask.id);
          workflowStatus = "degraded";
          // Continue with remaining subtasks where possible
        } else {
          completed.set(subtask.id, result);

          // Publish step completion
          await this.services.bus.publish(
            "workflow.step.complete",
            {
              workflowId: dag.id,
              subtaskId: subtask.id,
              agentName: result.agentName,
              durationMs: result.durationMs,
              qualityScore: result.qualityScore,
            },
            this.services.orchestratorIdentity,
            { correlationId: dag.id },
          );
        }

        const idx = remaining.indexOf(subtask);
        if (idx !== -1) remaining.splice(idx, 1);
      }
    }

    const subtaskResults = Array.from(completed.values());
    const totalSubtaskCostUsdc = subtaskResults.reduce((s, r) => s + r.costUsdc, 0);
    const orchestrationMarginUsdc = totalSubtaskCostUsdc * this.ORCHESTRATION_MARGIN;
    const totalChargedUsdc = totalSubtaskCostUsdc + orchestrationMarginUsdc;

    return {
      workflowId: dag.id,
      status: workflowStatus,
      subtaskResults,
      assembledOutput: null, // filled by OutputAssembler
      qualityScore: 0,        // filled by OutputAssembler
      totalSubtaskCostUsdc,
      orchestrationMarginUsdc,
      totalChargedUsdc,
      durationMs: Date.now() - startMs,
    };
  }

  private enrichInput(
    subtask: Subtask,
    completed: Map<string, SubtaskResult>,
  ): Record<string, unknown> {
    const base = { ...subtask.input };

    // For research.synthesis: populate sources from web search output
    if (subtask.capability === "research.synthesis") {
      for (const depId of subtask.dependencies) {
        const dep = completed.get(depId);
        if (!dep) continue;
        const output = dep.output as { results?: Array<{ url?: string }> } | null;
        if (output?.results) {
          base["sources"] = output.results
            .slice(0, 5)
            .map((r) => r.url ?? "")
            .filter(Boolean);
        }
      }
    }

    // For coding.review.security: populate pr_url from implementation output
    if (subtask.capability === "coding.review.security") {
      for (const depId of subtask.dependencies) {
        const dep = completed.get(depId);
        if (!dep) continue;
        const output = dep.output as { pr_url?: string } | null;
        if (output?.pr_url) {
          base["pr_url"] = output.pr_url;
        }
      }
    }

    return base;
  }

  private async executeSubtask(
    subtask: Subtask,
    input: Record<string, unknown>,
    workflowId: string,
  ): Promise<SubtaskResult | null> {
    // Discover candidates
    const { entries } = this.services.registry.discover({
      taxonomy: subtask.capability,
      onlineOnly: false,
    });

    if (entries.length === 0) {
      console.warn(`[orchestrator] No agents found for capability: ${subtask.capability}`);
      return null;
    }

    const ranked = this.matcher.rankCandidates(entries, subtask.capability, subtask.budgetAllocation);

    // Try top 3 candidates (retry with same agent first, then alternatives)
    const candidates = ranked.slice(0, 3);

    for (const candidate of candidates) {
      // Attempt + retry on same agent
      for (let attempt = 0; attempt <= 1; attempt++) {
        const result = await this.attemptSubtask(
          subtask,
          input,
          candidate.agent,
          workflowId,
        );
        if (result !== null) return result;
        if (attempt === 0) {
          console.warn(`[orchestrator] Subtask ${subtask.id} failed, retrying with same agent...`);
        }
      }
      console.warn(`[orchestrator] Agent ${candidate.agent.identity.name} exhausted retries, trying next candidate...`);
    }

    return null; // All candidates failed
  }

  private async attemptSubtask(
    subtask: Subtask,
    input: Record<string, unknown>,
    candidate: RegistryEntry,
    workflowId: string,
  ): Promise<SubtaskResult | null> {
    const cap = candidate.identity.capabilities.find((c) => c.taxonomy === subtask.capability);
    if (!cap) return null;

    const startMs = Date.now();
    const costUsdc = cap.pricing.amount;

    try {
      const contract = this.services.contracts.create({
        requester: this.services.orchestratorIdentity,
        provider: candidate.identity,
        capability: subtask.capability,
        inputSchema: cap.inputSchema,
        outputSchema: cap.outputSchema,
        input,
        payment: { amount: costUsdc, currency: "USDC" },
        sla: {
          deadlineMs: cap.sla.maxLatencyMs * 3,
          maxRetries: 1,
        },
        verification: { method: "quality_score", minQualityScore: 0.5 },
      });

      const deadline = cap.sla.maxLatencyMs * 3;

      // Set up delivery listener BEFORE triggering FUND (same pattern as SDK executeHire).
      // The Promise constructor runs synchronously, so the subscription is registered
      // before any lifecycle transitions happen — guaranteeing we never miss DELIVER.
      const deliveryPromise = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.services.bus.unsubscribe(subId);
          reject(new Error(`Subtask ${subtask.id} timed out after ${deadline}ms`));
        }, deadline);

        const subId = this.services.bus.subscribe("task.request", async (msg) => {
          const payload = msg.payload as { contractId?: string; event?: string };
          if (payload.contractId !== contract.id) return;
          if (payload.event === "DELIVER") {
            clearTimeout(timer);
            this.services.bus.unsubscribe(subId);
            resolve(this.services.contracts.get(contract.id)?.output ?? null);
          } else if (payload.event === "FAIL") {
            clearTimeout(timer);
            this.services.bus.unsubscribe(subId);
            reject(new Error(`Subtask ${subtask.id} failed during provider execution`));
          }
        });
      });

      // Drive contract lifecycle: OFFER → ACCEPT → FUND (triggers provider's onTask handler)
      await this.services.contracts.transition(contract.id, "OFFER", this.services.orchestratorIdentity.name);
      await this.services.contracts.transition(contract.id, "ACCEPT", candidate.identity.name);
      await this.services.contracts.transition(contract.id, "FUND", this.services.orchestratorIdentity.name);

      // Now await the provider's DELIVER event (listener already registered above)
      const output = await deliveryPromise;

      const durationMs = Date.now() - startMs;
      const qualityScore = this.estimateQuality(output);

      return {
        subtaskId: subtask.id,
        agentName: candidate.identity.name,
        output,
        contractId: contract.id,
        durationMs,
        qualityScore,
        costUsdc,
      };
    } catch (err) {
      console.warn(`[orchestrator] Subtask ${subtask.id} attempt failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  private estimateQuality(output: unknown): number {
    if (output === null || output === undefined) return 0.0;
    if (typeof output !== "object") return 0.5;
    const obj = output as Record<string, unknown>;
    // Heuristic: more fields = more complete output
    const fieldCount = Object.keys(obj).length;
    return Math.min(1.0, 0.5 + fieldCount * 0.05);
  }

  private async escalateToHuman(workflowId: string, subtaskId: string): Promise<void> {
    await this.services.bus.publish(
      "escalation",
      {
        sessionId: workflowId,
        reason: `Subtask ${subtaskId} failed after all retries. Manual intervention required.`,
        severity: "warning" as const,
        context: { workflowId, subtaskId },
      },
      this.services.orchestratorIdentity,
      { correlationId: workflowId },
    );
  }
}

// ─────────────────────────────────────────────────────────
// OutputAssembler
// ─────────────────────────────────────────────────────────

export interface AssembledOutput {
  assembledOutput: unknown;
  qualityScore: number;
  qualityPasses: boolean;
  weakestSubtaskId: string | null;
}

/**
 * Collects all subtask outputs and merges them into a coherent deliverable.
 * Runs a quality check against the original request.
 * If quality < 0.7, identifies the weakest subtask for rework.
 */
export class OutputAssembler {
  private static readonly QUALITY_THRESHOLD = 0.70;

  assemble(
    originalRequest: string,
    requestType: WorkflowRequestType,
    subtaskResults: SubtaskResult[],
  ): AssembledOutput {
    const assembled = this.mergeOutputs(requestType, subtaskResults);
    const qualityScore = this.scoreQuality(originalRequest, assembled, subtaskResults);
    const qualityPasses = qualityScore >= OutputAssembler.QUALITY_THRESHOLD;

    let weakestSubtaskId: string | null = null;
    if (!qualityPasses && subtaskResults.length > 0) {
      const weakest = subtaskResults.reduce((min, r) =>
        r.qualityScore < min.qualityScore ? r : min,
      );
      weakestSubtaskId = weakest.subtaskId;
    }

    return { assembledOutput: assembled, qualityScore, qualityPasses, weakestSubtaskId };
  }

  private mergeOutputs(
    requestType: WorkflowRequestType,
    results: SubtaskResult[],
  ): Record<string, unknown> {
    switch (requestType) {
      case "research":
        return this.mergeResearch(results);
      case "analysis":
        return this.mergeAnalysis(results);
      case "content":
        return this.mergeContent(results);
      case "code":
        return this.mergeCode(results);
      default:
        return this.mergeGeneric(results);
    }
  }

  private mergeResearch(results: SubtaskResult[]): Record<string, unknown> {
    const searchResult = results.find((r) => r.subtaskId === "st-1")?.output as
      | { results?: Array<{ title?: string; url?: string; snippet?: string }> }
      | undefined;
    const synthesisResult = results.find((r) => r.subtaskId === "st-2")?.output as
      | { title?: string; summary?: string; key_findings?: string[]; confidence?: number }
      | undefined;
    const writeResult = results.find((r) => r.subtaskId === "st-3")?.output as
      | { markdown?: string; sections_written?: string[] }
      | undefined;

    return {
      type: "research_report",
      title: synthesisResult?.title ?? "Research Report",
      summary: synthesisResult?.summary ?? "",
      key_findings: synthesisResult?.key_findings ?? [],
      sources_searched: searchResult?.results?.length ?? 0,
      source_urls: (searchResult?.results ?? []).slice(0, 5).map((r) => r.url).filter(Boolean),
      formatted_report: writeResult?.markdown ?? synthesisResult?.summary ?? "",
      sections: writeResult?.sections_written ?? [],
      confidence: synthesisResult?.confidence ?? 0,
    };
  }

  private mergeAnalysis(results: SubtaskResult[]): Record<string, unknown> {
    const dataResult = results.find((r) => r.subtaskId === "st-2")?.output as
      | { summary?: string; trends?: unknown[]; statistics?: unknown; rows_analyzed?: number }
      | undefined;
    const reportResult = results.find((r) => r.subtaskId === "st-3")?.output as
      | { markdown?: string; sections_written?: string[] }
      | undefined;

    return {
      type: "analysis_report",
      summary: dataResult?.summary ?? "",
      statistics: dataResult?.statistics ?? {},
      trends: dataResult?.trends ?? [],
      rows_analyzed: dataResult?.rows_analyzed ?? 0,
      report: reportResult?.markdown ?? dataResult?.summary ?? "",
      sections: reportResult?.sections_written ?? [],
    };
  }

  private mergeContent(results: SubtaskResult[]): Record<string, unknown> {
    const contentResult = results.find((r) => r.subtaskId === "st-2")?.output as
      | { markdown?: string; content?: string; headline?: string; word_count?: number }
      | undefined;

    return {
      type: "content",
      content: contentResult?.markdown ?? contentResult?.content ?? "",
      headline: contentResult?.headline ?? "",
      word_count: contentResult?.word_count ?? 0,
    };
  }

  private mergeCode(results: SubtaskResult[]): Record<string, unknown> {
    const implResult = results.find((r) => r.subtaskId === "st-2")?.output as
      | { files_changed?: unknown[]; pr_url?: string; tests_passed?: boolean }
      | undefined;
    const reviewResult = results.find((r) => r.subtaskId === "st-3")?.output as
      | { vulnerabilities?: unknown[]; overall_risk?: string }
      | undefined;

    return {
      type: "code_delivery",
      files_changed: implResult?.files_changed ?? [],
      pr_url: implResult?.pr_url ?? "",
      tests_passed: implResult?.tests_passed ?? false,
      security_review: {
        vulnerabilities: reviewResult?.vulnerabilities ?? [],
        overall_risk: reviewResult?.overall_risk ?? "unknown",
      },
    };
  }

  private mergeGeneric(results: SubtaskResult[]): Record<string, unknown> {
    return {
      type: "generic_output",
      subtask_outputs: results.map((r) => ({
        subtask_id: r.subtaskId,
        agent: r.agentName,
        output: r.output,
      })),
    };
  }

  private scoreQuality(
    originalRequest: string,
    assembled: Record<string, unknown>,
    results: SubtaskResult[],
  ): number {
    // Relevance: does assembled output have content?
    const hasContent =
      typeof assembled["summary"] === "string" && assembled["summary"].length > 20 ||
      typeof assembled["content"] === "string" && assembled["content"].length > 20 ||
      typeof assembled["report"] === "string" && assembled["report"].length > 20 ||
      typeof assembled["formatted_report"] === "string" && assembled["formatted_report"].length > 20 ||
      (assembled["files_changed"] as unknown[])?.length > 0;

    const relevance = hasContent ? 0.8 : 0.3;

    // Completeness: fraction of subtasks that succeeded
    const completeness = results.length > 0
      ? results.filter((r) => r.output !== null).length / results.length
      : 0;

    // Coherence: average quality of individual subtask outputs
    const coherence = results.length > 0
      ? results.reduce((s, r) => s + r.qualityScore, 0) / results.length
      : 0;

    // Weighted composite
    return relevance * 0.40 + completeness * 0.35 + coherence * 0.25;
  }
}

// ─────────────────────────────────────────────────────────
// OrchestratorAgent — IAgentAdapter implementation
// ─────────────────────────────────────────────────────────

export interface OrchestratorServices {
  bus: IClawBus;
  registry: ServiceRegistry;
  contracts: ContractEngine;
}

/**
 * Full orchestrator agent. Wires TaskDecomposer → AgentMatcher →
 * WorkflowExecutor → OutputAssembler together. Calculates P&L with
 * 15% orchestration margin.
 */
export class OrchestratorAgent implements IAgentAdapter {
  readonly name = "agent-orchestrator";

  private identity: AgentIdentity | null = null;
  private state: AgentStatus["state"] = "idle";
  private tasksCompleted = 0;
  private startedAt = Date.now();

  private readonly decomposer = new TaskDecomposer();
  private readonly assembler = new OutputAssembler();

  constructor(private readonly services: OrchestratorServices) {}

  async initialize(config: AgentConfig): Promise<void> {
    this.identity = config.identity;
    this.state = "idle";
    this.startedAt = Date.now();
  }

  async execute(task: TaskPayload): Promise<TaskResult> {
    if (!this.identity) throw new Error("OrchestratorAgent not initialized");

    const startMs = Date.now();
    this.state = "working";

    try {
      const input = task.input as {
        request?: string;
        total_budget_usdc?: number;
        quality_threshold?: number;
      };

      if (!input?.request) {
        throw new Error("OrchestratorAgent requires 'request' in task input");
      }

      const request = input.request;
      const totalBudget = input.total_budget_usdc ?? 1.0;

      // 1. Decompose
      const dag = this.decomposer.decompose(request, totalBudget);

      // 2. Execute workflow
      const executor = new WorkflowExecutor({
        bus: this.services.bus,
        registry: this.services.registry,
        contracts: this.services.contracts,
        orchestratorIdentity: this.identity,
      });

      const workflowResult = await executor.execute(dag);

      // 3. Assemble output
      const { assembledOutput, qualityScore, qualityPasses, weakestSubtaskId } =
        this.assembler.assemble(request, dag.requestType, workflowResult.subtaskResults);

      workflowResult.assembledOutput = assembledOutput;
      workflowResult.qualityScore = qualityScore;

      // 4. Build agent utilization summary
      const agentUtilization = this.buildUtilizationSummary(workflowResult.subtaskResults);

      // 5. Compose final output with P&L
      const output = {
        workflow_id: dag.id,
        status: workflowResult.status,
        output: assembledOutput,
        quality_score: qualityScore,
        quality_passes: qualityPasses,
        weakest_subtask: weakestSubtaskId,
        pnl: {
          subtask_cost_usdc: workflowResult.totalSubtaskCostUsdc,
          orchestration_margin_usdc: workflowResult.orchestrationMarginUsdc,
          total_charged_usdc: workflowResult.totalChargedUsdc,
          margin_percent: 15,
        },
        steps_completed: workflowResult.subtaskResults.length,
        steps_total: dag.subtasks.length,
        duration_ms: workflowResult.durationMs,
        agent_utilization: agentUtilization,
      };

      this.tasksCompleted++;
      this.state = "idle";

      return {
        output,
        metrics: {
          durationMs: Date.now() - startMs,
          resourceCost: workflowResult.totalChargedUsdc,
        },
        logs: [
          `Workflow ${dag.id} completed: ${workflowResult.subtaskResults.length}/${dag.subtasks.length} subtasks`,
          `Quality score: ${(qualityScore * 100).toFixed(0)}%`,
          `P&L: ${workflowResult.totalSubtaskCostUsdc.toFixed(4)} subtask cost + ${workflowResult.orchestrationMarginUsdc.toFixed(4)} margin = ${workflowResult.totalChargedUsdc.toFixed(4)} USDC total`,
        ],
      };
    } catch (err) {
      this.state = "error";
      throw err;
    }
  }

  async *stream(task: TaskPayload): AsyncIterable<TaskChunk> {
    yield {
      type: "text",
      content: "Starting orchestration workflow...",
      timestamp: new Date().toISOString(),
    };

    const result = await this.execute(task);
    const output = result.output as { workflow_id?: string; quality_score?: number };

    yield {
      type: "text",
      content: `Workflow ${output?.workflow_id} complete. Quality: ${((output?.quality_score ?? 0) * 100).toFixed(0)}%`,
      timestamp: new Date().toISOString(),
    };
  }

  report(): AgentStatus {
    return {
      state: this.state,
      uptime: Date.now() - this.startedAt,
      tasksCompleted: this.tasksCompleted,
    };
  }

  async terminate(_reason?: string): Promise<void> {
    this.state = "terminated";
  }

  private buildUtilizationSummary(
    results: SubtaskResult[],
  ): Array<{ agent_name: string; tasks_completed: number; cost_usdc: number; quality_score: number }> {
    const byAgent = new Map<
      string,
      { tasks: number; cost: number; qualitySum: number }
    >();

    for (const r of results) {
      const existing = byAgent.get(r.agentName) ?? { tasks: 0, cost: 0, qualitySum: 0 };
      byAgent.set(r.agentName, {
        tasks: existing.tasks + 1,
        cost: existing.cost + r.costUsdc,
        qualitySum: existing.qualitySum + r.qualityScore,
      });
    }

    return Array.from(byAgent.entries()).map(([name, stats]) => ({
      agent_name: name,
      tasks_completed: stats.tasks,
      cost_usdc: stats.cost,
      quality_score: stats.tasks > 0 ? stats.qualitySum / stats.tasks : 0,
    }));
  }
}

// ─────────────────────────────────────────────────────────
// Plugin module export
// ─────────────────────────────────────────────────────────

export default {
  name: "agent-orchestrator",
  type: "agent",
  version: "0.1.0",
  create: (config?: Record<string, unknown>) => {
    const services = config as unknown as OrchestratorServices;
    return new OrchestratorAgent(services);
  },
} satisfies PluginModule<OrchestratorAgent>;
