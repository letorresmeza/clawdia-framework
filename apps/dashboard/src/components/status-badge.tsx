const stateColors: Record<string, string> = {
  // Session states
  running: "bg-green-500/10 text-green-400 border-green-500/20",
  paused: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  dead: "bg-red-500/10 text-red-400 border-red-500/20",
  initializing: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  terminating: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  completing: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  // Registry statuses
  online: "bg-green-500/10 text-green-400 border-green-500/20",
  offline: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  busy: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  // Contract states
  draft: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  offered: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  accepted: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  in_progress: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  delivered: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  verified: "bg-green-500/10 text-green-400 border-green-500/20",
  settled: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  disputed: "bg-red-500/10 text-red-400 border-red-500/20",
  cancelled: "bg-slate-600/10 text-slate-500 border-slate-600/20",
};

export function StatusBadge({ status }: { status: string }) {
  const colors = stateColors[status] ?? "bg-slate-500/10 text-slate-400 border-slate-500/20";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors}`}>
      {status.replace("_", " ")}
    </span>
  );
}
