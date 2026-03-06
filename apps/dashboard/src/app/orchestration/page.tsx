"use client";

import { usePolling } from "@/hooks/use-polling";
import { StatusBadge } from "@/components/status-badge";

interface OrchestrationSummary {
  activeWorkflows: number;
  completedJobs: number;
  totalBrokeredUsdc: number;
  totalMarginUsdc: number;
  registeredSpecialists: number;
  brokerOnline: boolean;
}

interface ActiveWorkflow {
  contractId: string;
  capability: string;
  requester: string;
  provider: string;
  state: string;
  createdAt: string;
  payment: { amount: number; currency: string };
}

interface RecentJob {
  contractId: string;
  workflowId: string | null;
  status: string;
  qualityScore: number | null;
  totalChargedUsdc: number;
  marginUsdc: number;
  stepsCompleted: number;
  stepsTotal: number;
  durationMs: number;
  settledAt: string;
}

interface AgentUtilization {
  agentName: string;
  tasksCompleted: number;
  tasksFailed: number;
  averageQualityScore: number | null;
  successRate: number;
}

interface OrchestrationResponse {
  summary: OrchestrationSummary;
  activeWorkflows: ActiveWorkflow[];
  recentJobs: RecentJob[];
  agentUtilization: AgentUtilization[];
  qualityByAgent: AgentUtilization[];
  contractStats: Record<string, number>;
}

export default function OrchestrationPage() {
  const { data, loading } = usePolling<OrchestrationResponse>("/api/orchestration", 3000);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Orchestration</h1>
          <p className="mt-1 text-sm text-slate-400">
            Clawdia Broker — agent-of-agents workflow engine
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
            <div
              className={`h-2 w-2 rounded-full ${data.summary.brokerOnline ? "bg-green-400" : "bg-slate-600"}`}
            />
            <span className="text-xs text-slate-400">
              {data.summary.brokerOnline ? "Broker online" : "Broker offline"}
            </span>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {data && (
        <div className="mt-6 grid grid-cols-5 gap-4">
          <StatCard
            label="Active Workflows"
            value={String(data.summary.activeWorkflows)}
            color={data.summary.activeWorkflows > 0 ? "text-yellow-400" : "text-slate-100"}
          />
          <StatCard
            label="Jobs Completed"
            value={String(data.summary.completedJobs)}
            color="text-green-400"
          />
          <StatCard
            label="Total Brokered"
            value={`${data.summary.totalBrokeredUsdc.toFixed(4)} USDC`}
            color="text-indigo-400"
          />
          <StatCard
            label="Margin Earned"
            value={`${data.summary.totalMarginUsdc.toFixed(4)} USDC`}
            color="text-amber-400"
          />
          <StatCard
            label="Specialists Online"
            value={String(data.summary.registeredSpecialists)}
            color="text-cyan-400"
          />
        </div>
      )}

      {/* Active Workflows */}
      <Section title="Active Workflows">
        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Contract</th>
                <th className="px-4 py-3">Capability</th>
                <th className="px-4 py-3">Requester</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading && !data && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                    Loading...
                  </td>
                </tr>
              )}
              {data && data.activeWorkflows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                    No active workflows.{" "}
                    <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs">
                      clawdia broker &quot;your request here&quot;
                    </code>
                  </td>
                </tr>
              )}
              {data?.activeWorkflows.map((wf) => (
                <tr key={wf.contractId} className="hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {wf.contractId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-indigo-400">
                    {wf.capability}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-300">{wf.requester}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{wf.provider}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={wf.state} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-amber-400">
                    {wf.payment.amount.toFixed(4)} {wf.payment.currency}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(wf.createdAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Recent Brokered Jobs */}
      <Section title="Recent Jobs">
        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Workflow ID</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Steps</th>
                <th className="px-4 py-3">Quality</th>
                <th className="px-4 py-3">Total Charged</th>
                <th className="px-4 py-3">Margin</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Settled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data && data.recentJobs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                    No completed jobs yet.
                  </td>
                </tr>
              )}
              {data?.recentJobs.map((job) => (
                <tr key={job.contractId} className="hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {(job.workflowId ?? job.contractId).slice(0, 12)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">
                    {job.stepsCompleted}/{job.stepsTotal}
                  </td>
                  <td className="px-4 py-3">
                    {job.qualityScore !== null ? (
                      <QualityBar score={job.qualityScore} />
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-amber-400">
                    {job.totalChargedUsdc.toFixed(4)} USDC
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-green-400">
                    +{job.marginUsdc.toFixed(4)} USDC
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {job.durationMs > 0 ? `${(job.durationMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(job.settledAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Two-column: Utilization + Quality */}
      <div className="mt-8 grid grid-cols-2 gap-6">
        {/* Agent Utilization */}
        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-200">Agent Utilization</h2>
          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Completed</th>
                  <th className="px-4 py-3">Failed</th>
                  <th className="px-4 py-3">Success Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data && data.agentUtilization.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-600">
                      No utilization data yet.
                    </td>
                  </tr>
                )}
                {data?.agentUtilization.map((a) => (
                  <tr key={a.agentName} className="hover:bg-slate-800/50">
                    <td className="px-4 py-2.5 text-sm text-slate-300">{a.agentName}</td>
                    <td className="px-4 py-2.5 font-mono text-sm text-green-400">
                      {a.tasksCompleted}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-sm text-red-400">
                      {a.tasksFailed}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-12 rounded-full bg-slate-800">
                          <div
                            className="h-1.5 rounded-full bg-indigo-500"
                            style={{ width: `${a.successRate * 100}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs text-slate-400">
                          {(a.successRate * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quality Scores */}
        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-200">Quality Scores by Agent</h2>
          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Avg Quality</th>
                  <th className="px-4 py-3">Tasks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data && data.qualityByAgent.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-xs text-slate-600">
                      No quality data yet.
                    </td>
                  </tr>
                )}
                {data?.qualityByAgent.map((a) => (
                  <tr key={a.agentName} className="hover:bg-slate-800/50">
                    <td className="px-4 py-2.5 text-sm text-slate-300">{a.agentName}</td>
                    <td className="px-4 py-2.5">
                      {a.averageQualityScore !== null ? (
                        <QualityBar score={a.averageQualityScore} />
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                      {a.tasksCompleted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="mb-3 text-lg font-semibold text-slate-200">{title}</h2>
      {children}
    </div>
  );
}

function QualityBar({ score }: { score: number }) {
  const pct = score * 100;
  const color =
    score >= 0.7 ? "bg-green-500" : score >= 0.5 ? "bg-yellow-500" : "bg-red-500";
  const textColor =
    score >= 0.7 ? "text-green-400" : score >= 0.5 ? "text-yellow-400" : "text-red-400";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-slate-800">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-xs ${textColor}`}>{pct.toFixed(0)}%</span>
    </div>
  );
}
