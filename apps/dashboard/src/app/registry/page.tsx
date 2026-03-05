"use client";

import { usePolling } from "@/hooks/use-polling";
import { StatusBadge } from "@/components/status-badge";
import type { RegistryResponse } from "@/lib/types";

export default function RegistryPage() {
  const { data, loading } = usePolling<RegistryResponse>("/api/registry", 5000);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">Agent Registry</h1>
      <p className="mt-1 text-sm text-slate-400">Registered agents, capabilities, and reputation</p>

      {/* Stats Bar */}
      {data && (
        <div className="mt-6 grid grid-cols-3 gap-4">
          <StatCard label="Online" value={data.stats["online"] ?? 0} color="text-green-400" />
          <StatCard label="Offline" value={data.stats["offline"] ?? 0} color="text-slate-400" />
          <StatCard label="Busy" value={data.stats["busy"] ?? 0} color="text-amber-400" />
        </div>
      )}

      {/* Agent Cards */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {loading && !data && (
          <p className="col-span-full text-sm text-slate-500">Loading registry...</p>
        )}
        {data && data.entries.length === 0 && (
          <p className="col-span-full text-sm text-slate-500">No agents registered.</p>
        )}
        {data?.entries.map((entry) => (
          <div
            key={entry.identity.name}
            className="rounded-lg border border-slate-800 bg-slate-900 p-5"
          >
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-slate-100">{entry.identity.displayName}</h3>
                <p className="mt-0.5 font-mono text-xs text-slate-500">{entry.identity.name}</p>
              </div>
              <StatusBadge status={entry.status} />
            </div>

            {/* Meta */}
            <div className="mt-3 flex gap-4 text-xs text-slate-500">
              <span>v{entry.identity.version}</span>
              <span>{entry.identity.operator}</span>
              <span>Last seen: {new Date(entry.lastSeen).toLocaleTimeString()}</span>
            </div>

            {/* Reputation */}
            {entry.identity.reputation && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Reputation</span>
                  <span className="font-mono text-slate-300">
                    {(entry.identity.reputation.score * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800">
                  <div
                    className="h-1.5 rounded-full bg-indigo-500"
                    style={{ width: `${entry.identity.reputation.score * 100}%` }}
                  />
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1 text-xs text-slate-500">
                  <DimLabel label="Rel" value={entry.identity.reputation.dimensions.reliability} />
                  <DimLabel label="Qual" value={entry.identity.reputation.dimensions.quality} />
                  <DimLabel label="Spd" value={entry.identity.reputation.dimensions.speed} />
                  <DimLabel label="Cost" value={entry.identity.reputation.dimensions.costEfficiency} />
                </div>
              </div>
            )}

            {/* Capabilities */}
            {entry.identity.capabilities.length > 0 && (
              <div className="mt-4 border-t border-slate-800 pt-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Capabilities
                </p>
                <div className="space-y-2">
                  {entry.identity.capabilities.map((cap, i) => (
                    <div key={i} className="rounded border border-slate-800 bg-slate-950 px-3 py-2">
                      <span className="font-mono text-xs text-indigo-400">{cap.taxonomy}</span>
                      <div className="mt-1 flex gap-3 text-xs text-slate-500">
                        <span>
                          {cap.pricing.amount} {cap.pricing.currency}/{cap.pricing.model.replace("per_", "")}
                        </span>
                        <span>SLA: {cap.sla.maxLatencyMs}ms</span>
                        <span>Avail: {(cap.sla.availability * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function DimLabel({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-slate-600">{label}</p>
      <p className="font-mono text-slate-400">{(value * 100).toFixed(0)}</p>
    </div>
  );
}
