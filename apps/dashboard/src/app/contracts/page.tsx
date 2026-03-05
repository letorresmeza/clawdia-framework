"use client";

import { useState } from "react";
import { usePolling } from "@/hooks/use-polling";
import { StatusBadge } from "@/components/status-badge";
import { Timeline } from "@/components/timeline";
import type { ContractsResponse } from "@/lib/types";

type Tab = "all" | "active" | "completed" | "failed";

const ACTIVE_STATES = new Set(["draft", "offered", "accepted", "in_progress", "delivered", "verified"]);
const FAILED_STATES = new Set(["disputed", "cancelled"]);

export default function ContractsPage() {
  const { data, loading } = usePolling<ContractsResponse>("/api/contracts", 3000);
  const [tab, setTab] = useState<Tab>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = data?.contracts.filter((c) => {
    if (tab === "active") return ACTIVE_STATES.has(c.state);
    if (tab === "completed") return c.state === "settled";
    if (tab === "failed") return FAILED_STATES.has(c.state);
    return true;
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "completed", label: "Completed" },
    { key: "failed", label: "Failed" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">Task Contracts</h1>
      <p className="mt-1 text-sm text-slate-400">Contract lifecycle and history</p>

      {/* Stats */}
      {data && (
        <div className="mt-6 flex gap-3">
          {Object.entries(data.stats).map(([state, count]) => (
            <div key={state} className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5">
              <span className="text-xs text-slate-500">{state}: </span>
              <span className="font-mono text-sm text-slate-300">{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="mt-6 flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-slate-800 text-slate-100"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Capability</th>
              <th className="px-4 py-3">Parties</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && !data && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  Loading contracts...
                </td>
              </tr>
            )}
            {filtered && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  No contracts found.
                </td>
              </tr>
            )}
            {filtered?.map((contract) => (
              <tr key={contract.id} className="group">
                <td colSpan={6} className="p-0">
                  <button
                    onClick={() => setExpandedId(expandedId === contract.id ? null : contract.id)}
                    className="w-full text-left hover:bg-slate-800/50"
                  >
                    <div className="flex items-center">
                      <div className="w-[14%] px-4 py-3 font-mono text-xs text-slate-400">
                        {contract.id.slice(0, 8)}
                        <span className="ml-1 text-slate-600">
                          {expandedId === contract.id ? "\u25B2" : "\u25BC"}
                        </span>
                      </div>
                      <div className="w-[22%] px-4 py-3 font-mono text-xs text-indigo-400">
                        {contract.capability}
                      </div>
                      <div className="w-[22%] px-4 py-3 text-xs text-slate-300">
                        {contract.requester.name}
                        <span className="mx-1 text-slate-600">&rarr;</span>
                        {contract.provider?.name ?? <span className="text-slate-600">pending</span>}
                      </div>
                      <div className="w-[14%] px-4 py-3">
                        <StatusBadge status={contract.state} />
                      </div>
                      <div className="w-[14%] px-4 py-3 font-mono text-xs text-slate-300">
                        {contract.payment.amount} {contract.payment.currency}
                      </div>
                      <div className="w-[14%] px-4 py-3 text-xs text-slate-500">
                        {new Date(contract.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </button>

                  {/* Expanded History */}
                  {expandedId === contract.id && (
                    <div className="border-t border-slate-800 bg-slate-950 px-6 py-4">
                      <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">
                        History
                      </h4>
                      <Timeline history={contract.history} />

                      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-800 pt-4 text-xs">
                        <div>
                          <p className="text-slate-500">SLA Deadline</p>
                          <p className="font-mono text-slate-300">{contract.sla.deadlineMs}ms</p>
                        </div>
                        <div>
                          <p className="text-slate-500">Max Retries</p>
                          <p className="font-mono text-slate-300">{contract.sla.maxRetries}</p>
                        </div>
                        <div>
                          <p className="text-slate-500">Verification</p>
                          <p className="font-mono text-slate-300">{contract.verification.method}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
