"use client";

import { usePolling } from "@/hooks/use-polling";
import { StatusBadge } from "@/components/status-badge";
import type { EconomyResponse } from "@/lib/types";

export default function EconomyPage() {
  const { data, loading } = usePolling<EconomyResponse>("/api/economy", 5000);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">Economy</h1>
      <p className="mt-1 text-sm text-slate-400">
        Reputation, escrow, and billing overview
      </p>

      {/* Stats Cards */}
      {data && (
        <div className="mt-6 grid grid-cols-5 gap-4">
          <StatCard
            label="Agents Tracked"
            value={String(data.reputation.stats.totalAgents)}
            color="text-slate-100"
          />
          <StatCard
            label="Avg Reputation"
            value={`${(data.reputation.stats.averageScore * 100).toFixed(0)}%`}
            color="text-indigo-400"
          />
          <StatCard
            label="Total Escrow Value"
            value={formatValue(data.escrow.stats.totalValue)}
            color="text-amber-400"
          />
          <StatCard
            label="Total Revenue"
            value={`$${data.billing.stats.totalRevenue.toFixed(2)}`}
            color="text-green-400"
          />
          <StatCard
            label="Platform Fees"
            value={`$${data.billing.stats.totalFees.toFixed(2)}`}
            color="text-cyan-400"
          />
        </div>
      )}

      {/* Reputation Table */}
      <Section title="Reputation">
        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Reliability</th>
                <th className="px-4 py-3">Quality</th>
                <th className="px-4 py-3">Speed</th>
                <th className="px-4 py-3">Cost Eff.</th>
                <th className="px-4 py-3">Completed</th>
                <th className="px-4 py-3">Failed</th>
                <th className="px-4 py-3">Stake</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading && !data && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                    Loading...
                  </td>
                </tr>
              )}
              {data && data.reputation.records.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                    No reputation data yet.
                  </td>
                </tr>
              )}
              {data?.reputation.records.map((record) => (
                <tr key={record.agentName} className="hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-medium text-slate-200">
                    {record.agentName}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-slate-800">
                        <div
                          className="h-1.5 rounded-full bg-indigo-500"
                          style={{ width: `${record.overallScore * 100}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs text-slate-300">
                        {(record.overallScore * 100).toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <DimScore value={record.dimensions.reliability} />
                  </td>
                  <td className="px-4 py-3">
                    <DimScore value={record.dimensions.quality} />
                  </td>
                  <td className="px-4 py-3">
                    <DimScore value={record.dimensions.speed} />
                  </td>
                  <td className="px-4 py-3">
                    <DimScore value={record.dimensions.costEfficiency} />
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-green-400">
                    {record.contractsCompleted}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-red-400">
                    {record.contractsFailed}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {record.stakedAmount} {record.stakeCurrency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Escrow Table */}
      <Section title="Escrows">
        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
          {data && (
            <div className="flex gap-3 border-b border-slate-800 px-4 py-2">
              <MiniStat label="Funded" value={data.escrow.stats.funded} />
              <MiniStat label="Released" value={data.escrow.stats.released} />
              <MiniStat label="Disputed" value={data.escrow.stats.disputed} />
            </div>
          )}
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Escrow ID</th>
                <th className="px-4 py-3">Contract</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data && data.escrow.escrows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                    No escrows.
                  </td>
                </tr>
              )}
              {data?.escrow.escrows.map((e) => (
                <tr key={e.id} className="hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {e.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {e.contractId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-300">
                    {String(e.amount)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{e.currency}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Recent Billing */}
      <Section title="Recent Usage">
        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
          {data && (
            <div className="flex gap-3 border-b border-slate-800 px-4 py-2">
              <MiniStat label="Records" value={data.billing.stats.totalRecords} />
              <MiniStat label="Invoices" value={data.billing.stats.invoiceCount} />
            </div>
          )}
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Quantity</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data && data.billing.recentRecords.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                    No usage recorded yet.
                  </td>
                </tr>
              )}
              {data?.billing.recentRecords.map((r) => (
                <tr key={r.id} className="hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-sm text-slate-200">{r.agentName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-indigo-400">
                    {r.resourceType}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">
                    {r.quantity} {r.unit}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">
                    {r.cost > 0 ? `${r.cost.toFixed(4)} ${r.currency}` : "-"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(r.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
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

function DimScore({ value }: { value: number }) {
  const pct = (value * 100).toFixed(0);
  const color = value >= 0.7 ? "text-green-400" : value >= 0.4 ? "text-yellow-400" : "text-red-400";
  return <span className={`font-mono text-xs ${color}`}>{pct}</span>;
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1">
      <span className="text-xs text-slate-500">{label}: </span>
      <span className="font-mono text-xs text-slate-300">{value}</span>
    </div>
  );
}

function formatValue(microUnits: number): string {
  if (microUnits === 0) return "$0";
  const amount = microUnits / 1_000_000;
  return `$${amount.toFixed(2)}`;
}
