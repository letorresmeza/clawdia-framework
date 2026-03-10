import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchContracts, fetchRegistryEntries } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenant = request.nextUrl.searchParams.get("tenant");
    const [allContracts, registryEntries] = await Promise.all([
      fetchContracts(),
      fetchRegistryEntries(),
    ]);
    const tenantContracts = allContracts.filter((contract) =>
      tenant
        ? contract.requester.operator === tenant || contract.provider?.operator === tenant
        : true,
    );
    const tenantRegistryEntries = registryEntries.filter((entry) =>
      tenant ? entry.identity.operator === tenant : true,
    );

    // Collect workflow-related contracts (capability starts with "orchestration.")
    const orchestrationContracts = tenantContracts.filter((c) =>
      c.capability.startsWith("orchestration."),
    );

    // Active workflows: in_progress
    const activeContracts = orchestrationContracts.filter((c) => c.state === "in_progress");

    // Completed workflows: settled
    const settledContracts = orchestrationContracts.filter((c) => c.state === "settled");

    // Calculate P&L from settled orchestration jobs
    let totalBrokeredUsdc = 0;
    let totalMarginUsdc = 0;

    for (const c of settledContracts) {
      if (c.capability === "orchestration.job.broker") {
        const output = c.output as {
          pnl?: {
            subtask_cost_usdc?: number;
            orchestration_margin_usdc?: number;
            total_charged_usdc?: number;
          };
        } | null;
        if (output?.pnl) {
          totalBrokeredUsdc += output.pnl.total_charged_usdc ?? 0;
          totalMarginUsdc += output.pnl.orchestration_margin_usdc ?? 0;
        }
      }
    }

    // Agent utilization: count contracts per provider
    const agentContractCounts = new Map<
      string,
      { completed: number; failed: number; totalQuality: number; qualityCount: number }
    >();

    for (const c of tenantContracts) {
      if (!c.provider) continue;
      const name = c.provider.name;
      const existing = agentContractCounts.get(name) ?? {
        completed: 0,
        failed: 0,
        totalQuality: 0,
        qualityCount: 0,
      };

      if (c.state === "settled") {
        existing.completed++;
        // Extract quality score from output if available
        const output = c.output as { quality_score?: number } | null;
        if (output?.quality_score !== undefined) {
          existing.totalQuality += output.quality_score;
          existing.qualityCount++;
        }
      } else if (c.state === "disputed" || c.state === "cancelled") {
        existing.failed++;
      }

      agentContractCounts.set(name, existing);
    }

    const agentUtilization = Array.from(agentContractCounts.entries())
      .map(([agentName, stats]) => ({
        agentName,
        tasksCompleted: stats.completed,
        tasksFailed: stats.failed,
        averageQualityScore:
          stats.qualityCount > 0 ? stats.totalQuality / stats.qualityCount : null,
        successRate:
          stats.completed + stats.failed > 0
            ? stats.completed / (stats.completed + stats.failed)
            : 1.0,
      }))
      .sort((a, b) => b.tasksCompleted - a.tasksCompleted);

    // Quality scores per agent (from settled contracts with quality_score in output)
    const qualityByAgent = agentUtilization
      .filter((a) => a.averageQualityScore !== null)
      .sort((a, b) => (b.averageQualityScore ?? 0) - (a.averageQualityScore ?? 0));

    // Registry stats (specialists vs broker)
    const brokerEntry = tenantRegistryEntries.find((e) =>
      e.identity.capabilities.some((c) => c.taxonomy.startsWith("orchestration.")),
    );
    const specialistCount = tenantRegistryEntries.filter((e) => e !== brokerEntry).length;

    // Active workflow progress from in-progress contracts
    const activeWorkflows = activeContracts.map((c) => ({
      contractId: c.id,
      capability: c.capability,
      requester: c.requester.name,
      provider: c.provider?.name ?? "unknown",
      state: c.state,
      createdAt: c.createdAt,
      payment: c.payment,
    }));

    // Recent settled workflows with output summary
    const recentJobs = settledContracts
      .filter((c) => c.capability === "orchestration.job.broker")
      .slice(-10)
      .reverse()
      .map((c) => {
        const output = c.output as {
          workflow_id?: string;
          status?: string;
          quality_score?: number;
          pnl?: { total_charged_usdc?: number; orchestration_margin_usdc?: number };
          steps_completed?: number;
          steps_total?: number;
          duration_ms?: number;
        } | null;
        return {
          contractId: c.id,
          workflowId: output?.workflow_id,
          status: output?.status ?? c.state,
          qualityScore: output?.quality_score ?? null,
          totalChargedUsdc: output?.pnl?.total_charged_usdc ?? c.payment.amount,
          marginUsdc: output?.pnl?.orchestration_margin_usdc ?? 0,
          stepsCompleted: output?.steps_completed ?? 0,
          stepsTotal: output?.steps_total ?? 0,
          durationMs: output?.duration_ms ?? 0,
          settledAt: c.updatedAt,
        };
      });

    return NextResponse.json({
      summary: {
        activeWorkflows: activeContracts.length,
        completedJobs: settledContracts.filter((c) => c.capability === "orchestration.job.broker")
          .length,
        totalBrokeredUsdc,
        totalMarginUsdc,
        registeredSpecialists: specialistCount,
        brokerOnline: brokerEntry?.status === "online",
      },
      activeWorkflows,
      recentJobs,
      agentUtilization,
      qualityByAgent,
      contractStats: tenantContracts.reduce<Record<string, number>>((acc, contract) => {
        acc[contract.state] = (acc[contract.state] ?? 0) + 1;
        return acc;
      }, {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
