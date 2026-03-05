"use client";

import { usePolling } from "@/hooks/use-polling";
import { StatusBadge } from "@/components/status-badge";
import { HeartbeatDot } from "@/components/heartbeat-dot";
import type { SessionsResponse } from "@/lib/types";

export default function SessionsPage() {
  const { data, loading } = usePolling<SessionsResponse>("/api/sessions", 3000);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">Agent Sessions</h1>
      <p className="mt-1 text-sm text-slate-400">Live overview of all active agent sessions</p>

      {/* Stats Bar */}
      {data && (
        <div className="mt-6 grid grid-cols-4 gap-4">
          <StatCard label="Total" value={data.stats.total} color="text-slate-100" />
          <StatCard label="Running" value={data.stats.running} color="text-green-400" />
          <StatCard label="Paused" value={data.stats.paused} color="text-yellow-400" />
          <StatCard label="Dead" value={data.stats.dead} color="text-red-400" />
        </div>
      )}

      {/* Sessions Table */}
      <div className="mt-6 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Session ID</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Heartbeat</th>
              <th className="px-4 py-3">Tasks</th>
              <th className="px-4 py-3">Contracts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && !data && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  Loading sessions...
                </td>
              </tr>
            )}
            {data && data.sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  No active sessions. Use <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs">clawdia spawn</code> to start an agent.
                </td>
              </tr>
            )}
            {data?.sessions.map((session) => (
              <tr key={session.id} className="hover:bg-slate-800/50">
                <td className="px-4 py-3">
                  <div>
                    <span className="font-medium text-slate-200">{session.identity.name}</span>
                    <span className="ml-2 text-xs text-slate-500">v{session.identity.version}</span>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">
                  {session.id.slice(0, 8)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={session.state} />
                </td>
                <td className="px-4 py-3">
                  <HeartbeatDot lastHeartbeat={session.lastHeartbeat} />
                </td>
                <td className="px-4 py-3 font-mono text-sm text-slate-300">
                  {session.tasksCompleted}
                </td>
                <td className="px-4 py-3 font-mono text-sm text-slate-300">
                  {session.activeContracts.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
