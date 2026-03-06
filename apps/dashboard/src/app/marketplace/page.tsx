"use client";

import { useState } from "react";
import { usePolling } from "@/hooks/use-polling";
import type { MarketplaceResponse } from "@/lib/types";

const RESOURCE_LABELS: Record<string, string> = {
  compute_gpu:    "GPU Compute",
  compute_cpu:    "CPU Compute",
  api_credits:    "API Credits",
  data_feed:      "Data Feed",
  context_window: "Context Window",
  memory:         "Memory",
};

const RESOURCE_UNITS: Record<string, string> = {
  compute_gpu:    "gpu-min",
  compute_cpu:    "cpu-min",
  api_credits:    "credit",
  data_feed:      "MB",
  context_window: "1K-tok",
  memory:         "GB-hr",
};

const RESOURCE_COLORS: Record<string, string> = {
  compute_gpu:    "text-violet-400",
  compute_cpu:    "text-blue-400",
  api_credits:    "text-green-400",
  data_feed:      "text-amber-400",
  context_window: "text-cyan-400",
  memory:         "text-rose-400",
};

export default function MarketplacePage() {
  const { data, loading } = usePolling<MarketplaceResponse>("/api/marketplace", 3000);
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded]   = useState(false);

  async function seedDemo() {
    setSeeding(true);
    await fetch("/api/marketplace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seed" }) });
    setSeeding(false);
    setSeeded(true);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Resource Marketplace</h1>
          <p className="mt-1 text-sm text-slate-400">
            Live resource prices, order book, and trading history
          </p>
        </div>
        {!seeded && (
          <button
            onClick={seedDemo}
            disabled={seeding}
            className="rounded-lg border border-indigo-600 bg-indigo-600/10 px-4 py-2 text-sm font-medium text-indigo-400 hover:bg-indigo-600/20 disabled:opacity-50"
          >
            {seeding ? "Seeding…" : "Seed Demo Data"}
          </button>
        )}
      </div>

      {/* Top stats */}
      {data && (
        <div className="mt-6 grid grid-cols-4 gap-4">
          <StatCard label="Active Listings"  value={String(data.activeListings)}                color="text-slate-100" />
          <StatCard label="Total Orders"     value={String(data.totalOrders)}                   color="text-indigo-400" />
          <StatCard label="Total Volume"     value={`$${data.totalVolume.toFixed(4)}`}           color="text-green-400" />
          <StatCard label="Platform Revenue" value={`$${data.platformRevenue.toFixed(4)}`}       color="text-amber-400" />
        </div>
      )}

      {/* Live Prices */}
      <Section title="Live Resource Prices">
        <div className="grid grid-cols-3 gap-3">
          {data ? (
            Object.entries(data.prices).map(([type, info]) => (
              <PriceCard key={type} type={type} info={info} />
            ))
          ) : (
            <p className="col-span-3 py-8 text-center text-sm text-slate-500">
              {loading ? "Loading prices…" : "No price data yet."}
            </p>
          )}
        </div>
      </Section>

      {/* Active Listings */}
      <Section title="Active Listings">
        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Seller</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Qty Available</th>
                <th className="px-4 py-3">Unit Price</th>
                <th className="px-4 py-3">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data && data.listings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                    No active listings. Click &quot;Seed Demo Data&quot; to populate.
                  </td>
                </tr>
              )}
              {data?.listings.map((l) => (
                <tr key={l.id} className="hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-medium text-slate-200">{l.seller}</td>
                  <td className="px-4 py-3">
                    <span className={`text-sm font-medium ${RESOURCE_COLORS[l.type] ?? "text-slate-300"}`}>
                      {RESOURCE_LABELS[l.type] ?? l.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-300">
                    {l.quantity.toLocaleString()} {RESOURCE_UNITS[l.type] ?? "unit"}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-green-400">
                    ${l.pricePerUnit.toFixed(4)}/{RESOURCE_UNITS[l.type] ?? "unit"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                      l.listingType === "spot"
                        ? "bg-blue-500/10 text-blue-400"
                        : "bg-purple-500/10 text-purple-400"
                    }`}>
                      {l.listingType}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Top Sellers */}
      <div className="mt-8 grid grid-cols-2 gap-6">
        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-200">Top Sellers</h2>
          <div className="space-y-2">
            {data && data.topSellers.length === 0 && (
              <p className="text-sm text-slate-500">No sales yet.</p>
            )}
            {data?.topSellers.map((s, i) => (
              <div key={s.seller} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-400">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-200">{s.seller}</p>
                  <p className="text-xs text-slate-500">{s.orders} orders</p>
                </div>
                <span className="font-mono text-sm text-green-400">${s.volume.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Orders */}
        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-200">Recent Orders</h2>
          <div className="space-y-2">
            {data && data.recentOrders.length === 0 && (
              <p className="text-sm text-slate-500">No orders yet.</p>
            )}
            {data?.recentOrders.slice(0, 8).map((o) => (
              <div key={o.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${RESOURCE_COLORS[o.resourceType] ?? "text-slate-300"}`}>
                      {RESOURCE_LABELS[o.resourceType] ?? o.resourceType}
                    </span>
                    <span className="text-xs text-slate-500">×{o.quantity.toLocaleString()}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {o.buyer}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm text-slate-200">${o.totalPrice.toFixed(4)}</p>
                  <p className="font-mono text-xs text-slate-500">
                    @${o.pricePerUnit.toFixed(4)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Components ──────────────────────────────────────────

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

function PriceCard({
  type,
  info,
}: {
  type: string;
  info: { current: number; base: number; utilization: number; activeListings: number };
}) {
  const pctChange = ((info.current - info.base) / info.base) * 100;
  const utilPct   = (info.utilization * 100).toFixed(0);
  const color     = RESOURCE_COLORS[type] ?? "text-slate-300";

  const utilColor =
    info.utilization >= 0.8
      ? "text-red-400"
      : info.utilization >= 0.4
      ? "text-green-400"
      : "text-slate-500";

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-xs font-medium uppercase tracking-wider ${color}`}>
            {RESOURCE_LABELS[type] ?? type}
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-100">
            ${info.current.toFixed(4)}
          </p>
          <p className="text-xs text-slate-500">
            per {RESOURCE_UNITS[type] ?? "unit"}
          </p>
        </div>
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            pctChange > 0
              ? "bg-red-500/10 text-red-400"
              : pctChange < 0
              ? "bg-green-500/10 text-green-400"
              : "bg-slate-800 text-slate-500"
          }`}
        >
          {pctChange > 0 ? "+" : ""}
          {pctChange.toFixed(1)}%
        </span>
      </div>

      {/* Utilization bar */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Utilization</span>
          <span className={utilColor}>{utilPct}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800">
          <div
            className={`h-1.5 rounded-full transition-all ${
              info.utilization >= 0.8 ? "bg-red-500" : info.utilization >= 0.4 ? "bg-green-500" : "bg-slate-600"
            }`}
            style={{ width: `${Math.min(100, info.utilization * 100)}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-600">
          {info.activeListings.toLocaleString()} units available
        </p>
      </div>
    </div>
  );
}
