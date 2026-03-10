import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchContracts } from "@/lib/daemon-client";
import type { ContractState } from "@clawdia/types";
import type { ContractsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse<ContractsResponse>> {
  const state = request.nextUrl.searchParams.get("state") as ContractState | null;
  const tenant = request.nextUrl.searchParams.get("tenant");
  const contracts = await fetchContracts();
  const tenantContracts = contracts.filter((contract) =>
    tenant
      ? contract.requester.operator === tenant || contract.provider?.operator === tenant
      : true,
  );
  const filteredContracts = state
    ? tenantContracts.filter((contract) => contract.state === state)
    : tenantContracts;
  const stats = tenantContracts.reduce<Record<string, number>>((acc, contract) => {
    acc[contract.state] = (acc[contract.state] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    contracts: filteredContracts,
    stats,
    filter: state ?? undefined,
  });
}
