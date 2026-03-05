"use client";

import { useState, useRef, useEffect } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import type { ClawMessage } from "@clawdia/types";

const CHANNEL_COLORS: Record<string, string> = {
  "task.request": "bg-blue-500/20 text-blue-400",
  "task.result": "bg-blue-500/20 text-blue-300",
  "task.failed": "bg-blue-500/20 text-blue-500",
  "task.progress": "bg-blue-500/20 text-blue-200",
  heartbeat: "bg-green-500/20 text-green-400",
  escalation: "bg-orange-500/20 text-orange-400",
  "settlement.request": "bg-amber-500/20 text-amber-400",
  "settlement.complete": "bg-amber-500/20 text-amber-300",
  "registry.update": "bg-purple-500/20 text-purple-400",
  "registry.query": "bg-purple-500/20 text-purple-300",
  "risk.alert": "bg-red-500/20 text-red-400",
  "risk.budget.exceeded": "bg-red-500/20 text-red-500",
  "workflow.step.complete": "bg-cyan-500/20 text-cyan-400",
  "workflow.complete": "bg-cyan-500/20 text-cyan-300",
};

const CHANNEL_GROUPS = [
  { label: "Task", prefix: "task." },
  { label: "Heartbeat", prefix: "heartbeat" },
  { label: "Registry", prefix: "registry." },
  { label: "Risk", prefix: "risk." },
  { label: "Settlement", prefix: "settlement." },
  { label: "Escalation", prefix: "escalation" },
  { label: "Workflow", prefix: "workflow." },
];

function getWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3000/ws";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export default function LogsPage() {
  const { messages, status, clear } = useWebSocket(getWsUrl());
  const [autoScroll, setAutoScroll] = useState(true);
  const [enabledGroups, setEnabledGroups] = useState<Set<string>>(
    new Set(CHANNEL_GROUPS.map((g) => g.prefix))
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  const filteredMessages = messages.filter((msg) =>
    CHANNEL_GROUPS.some(
      (g) => enabledGroups.has(g.prefix) && (msg.channel === g.prefix || msg.channel.startsWith(g.prefix))
    )
  );

  const toggleGroup = (prefix: string) => {
    setEnabledGroups((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) {
        next.delete(prefix);
      } else {
        next.add(prefix);
      }
      return next;
    });
  };

  const statusColor =
    status === "connected"
      ? "bg-green-400"
      : status === "connecting"
        ? "bg-yellow-400 animate-pulse-dot"
        : "bg-red-400";

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Live Logs</h1>
          <p className="mt-1 text-sm text-slate-400">Real-time ClawBus message stream</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${statusColor}`} />
            <span className="text-xs text-slate-500">{status}</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-3">
        <div className="flex flex-wrap gap-2">
          {CHANNEL_GROUPS.map((group) => (
            <button
              key={group.prefix}
              onClick={() => toggleGroup(group.prefix)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                enabledGroups.has(group.prefix)
                  ? "bg-slate-700 text-slate-200"
                  : "bg-slate-800/50 text-slate-600"
              }`}
            >
              {group.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              autoScroll
                ? "bg-indigo-500/20 text-indigo-400"
                : "bg-slate-800 text-slate-500"
            }`}
          >
            Auto-scroll {autoScroll ? "ON" : "OFF"}
          </button>
          <button
            onClick={clear}
            className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-slate-300"
          >
            Clear
          </button>
          <span className="font-mono text-xs text-slate-600">
            {filteredMessages.length} msgs
          </span>
        </div>
      </div>

      {/* Log Stream */}
      <div
        ref={scrollRef}
        className="mt-3 flex-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-1"
      >
        {filteredMessages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-slate-600">
            {status === "connected"
              ? "Waiting for messages..."
              : "Connecting to WebSocket..."}
          </div>
        )}
        {filteredMessages.map((msg) => (
          <LogEntry key={msg.id} message={msg} />
        ))}
      </div>
    </div>
  );
}

function LogEntry({ message }: { message: ClawMessage }) {
  const time = new Date(message.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);

  const channelColor = CHANNEL_COLORS[message.channel] ?? "bg-slate-500/20 text-slate-400";
  const payloadStr = truncate(JSON.stringify(message.payload), 120);

  return (
    <div className="flex items-start gap-3 rounded px-3 py-1.5 font-mono text-xs hover:bg-slate-900/50">
      <span className="shrink-0 text-slate-600">{time}</span>
      <span className={`shrink-0 rounded px-1.5 py-0.5 ${channelColor}`}>
        {message.channel}
      </span>
      <span className="shrink-0 text-slate-500">{message.sender.name}</span>
      <span className="truncate text-slate-400">{payloadStr}</span>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
