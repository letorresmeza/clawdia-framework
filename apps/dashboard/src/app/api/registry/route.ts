import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchRegistryEntries } from "@/lib/daemon-client";
import type { RegistryResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse<RegistryResponse>> {
  const tenant = request.nextUrl.searchParams.get("tenant");
  const entries = (await fetchRegistryEntries()).filter((entry) =>
    tenant ? entry.identity.operator === tenant : true,
  );
  const stats = entries.reduce<Record<string, number>>(
    (acc, entry) => {
      acc[entry.status] = (acc[entry.status] ?? 0) + 1;
      return acc;
    },
    { online: 0, offline: 0, busy: 0 },
  );

  return NextResponse.json({
    entries,
    stats,
  });
}
