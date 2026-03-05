import { NextResponse } from "next/server";
import { getEngines } from "@/lib/engines";
import type { EconomyResponse } from "@/lib/types";
import type { EscrowHandle } from "@clawdia/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<EconomyResponse>> {
  const { reputation, escrow, billing } = await getEngines();

  const allRecords = billing.listRecords();
  const recentRecords = allRecords.slice(-10);

  // Serialize escrow handles (bigint → string for JSON)
  const escrows = escrow.listEscrows().map((e: EscrowHandle) => ({
    ...e,
    amount: e.amount,
  }));

  return NextResponse.json({
    reputation: {
      records: reputation.listRecords(),
      stats: reputation.stats(),
    },
    escrow: {
      escrows,
      stats: escrow.stats(),
    },
    billing: {
      recentRecords,
      stats: billing.stats(),
    },
  }, {
    // BigInt serialization
    status: 200,
  });
}
