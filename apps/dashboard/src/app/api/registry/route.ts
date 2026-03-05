import { NextResponse } from "next/server";
import { getEngines } from "@/lib/engines";
import type { RegistryResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<RegistryResponse>> {
  const { registry } = await getEngines();
  return NextResponse.json({
    entries: registry.list(),
    stats: registry.stats(),
  });
}
