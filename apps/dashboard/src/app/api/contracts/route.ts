import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getEngines } from "@/lib/engines";
import type { ContractState } from "@clawdia/types";
import type { ContractsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse<ContractsResponse>> {
  const { contracts } = await getEngines();
  const state = request.nextUrl.searchParams.get("state") as ContractState | null;
  const filter = state ? { state } : undefined;

  return NextResponse.json({
    contracts: contracts.list(filter),
    stats: contracts.stats(),
    filter: state ?? undefined,
  });
}
