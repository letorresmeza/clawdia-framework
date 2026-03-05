import type { ContractHistoryEntry } from "@clawdia/types";
import { StatusBadge } from "./status-badge";

export function Timeline({ history }: { history: ContractHistoryEntry[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-slate-500">No transitions yet</p>;
  }

  return (
    <div className="relative ml-3 border-l border-slate-700 pl-6">
      {history.map((entry, i) => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const date = new Date(entry.timestamp).toLocaleDateString();
        return (
          <div key={i} className="relative mb-4 last:mb-0">
            <div className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-slate-700 bg-slate-900" />
            <div className="flex items-center gap-2">
              <StatusBadge status={entry.from} />
              <span className="text-slate-600">&rarr;</span>
              <StatusBadge status={entry.to} />
              <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-400">
                {entry.event}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
              <span>{date} {time}</span>
              <span>by {entry.triggeredBy}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
