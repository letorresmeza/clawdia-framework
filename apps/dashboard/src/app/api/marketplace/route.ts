import { NextResponse } from "next/server";
import { getEngines } from "@/lib/engines";
import type { MarketplaceResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<MarketplaceResponse>> {
  const { marketplace } = await getEngines();

  const stats = marketplace.stats();

  return NextResponse.json({
    prices:          stats.prices,
    recentOrders:    stats.recentOrders,
    topSellers:      stats.topSellers,
    totalVolume:     stats.totalVolume,
    platformRevenue: stats.platformRevenue,
    activeListings:  stats.activeListings,
    totalOrders:     stats.totalOrders,
    listings:        marketplace.listListings(),
  });
}

// POST: seed demo data for the dashboard
export async function POST(req: Request): Promise<NextResponse> {
  const { marketplace } = await getEngines();
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === "seed") {
    // Create demo listings so the UI has data to show
    const sellers = ["gpu-cloud", "cpu-pool", "api-gateway", "data-lake", "context-bank"];

    const demoListings: Array<{ seller: string; type: string; quantity: number; pricePerUnit: number; currency: string }> = [
      { seller: sellers[0]!, type: "compute_gpu",    quantity: 500,  pricePerUnit: 0.48,  currency: "USDC" },
      { seller: sellers[1]!, type: "compute_cpu",    quantity: 2000, pricePerUnit: 0.045, currency: "USDC" },
      { seller: sellers[2]!, type: "api_credits",    quantity: 10000, pricePerUnit: 0.0018, currency: "USDC" },
      { seller: sellers[3]!, type: "data_feed",      quantity: 1000, pricePerUnit: 0.09,  currency: "USDC" },
      { seller: sellers[4]!, type: "context_window", quantity: 5000, pricePerUnit: 0.009, currency: "USDC" },
    ];

    for (const l of demoListings) {
      marketplace.listResource({
        seller:      l.seller,
        type:        l.type as Parameters<typeof marketplace.listResource>[0]["type"],
        quantity:    l.quantity,
        pricePerUnit: l.pricePerUnit,
        currency:    l.currency,
        listingType: "spot",
      });
    }

    // Simulate some buys to create history and price movement
    const buyers = ["analyst-agent", "trainer-agent", "scraper-agent"];
    const buys: Array<{ buyer: string; type: string; quantity: number }> = [
      { buyer: buyers[0]!, type: "api_credits",    quantity: 300 },
      { buyer: buyers[1]!, type: "compute_gpu",    quantity: 100 },
      { buyer: buyers[2]!, type: "data_feed",      quantity: 200 },
      { buyer: buyers[0]!, type: "compute_cpu",    quantity: 500 },
      { buyer: buyers[1]!, type: "context_window", quantity: 1000 },
    ];

    for (const b of buys) {
      marketplace.buyResource({
        buyer:    b.buyer,
        type:     b.type as Parameters<typeof marketplace.buyResource>[0]["type"],
        quantity: b.quantity,
        currency: "USDC",
      });
    }

    return NextResponse.json({ ok: true, seeded: demoListings.length });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
