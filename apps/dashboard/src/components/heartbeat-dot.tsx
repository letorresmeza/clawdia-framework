export function HeartbeatDot({ lastHeartbeat }: { lastHeartbeat: string }) {
  const elapsed = Date.now() - new Date(lastHeartbeat).getTime();
  const seconds = Math.floor(elapsed / 1000);

  let color: string;
  let animate: string;
  if (seconds < 60) {
    color = "bg-green-400";
    animate = "animate-pulse-dot";
  } else if (seconds < 120) {
    color = "bg-yellow-400";
    animate = "";
  } else {
    color = "bg-red-400";
    animate = "";
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${color} ${animate}`} />
      <span className="text-xs text-slate-500">
        {seconds < 60
          ? `${seconds}s ago`
          : seconds < 3600
            ? `${Math.floor(seconds / 60)}m ago`
            : `${Math.floor(seconds / 3600)}h ago`}
      </span>
    </div>
  );
}
