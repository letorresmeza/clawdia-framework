import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchDaemonJson } from "@/lib/daemon-client";
import type { SessionsResponse } from "@/lib/types";
import type { AgentSession } from "@clawdia/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse<SessionsResponse>> {
  const tenant = request.nextUrl.searchParams.get("tenant");
  const sessions = (await fetchDaemonJson<AgentSession[]>("/api/sessions")).filter((session) =>
    tenant ? session.identity.operator === tenant : true,
  );
  const running = sessions.filter((s) => s.state === "running").length;
  const paused = sessions.filter((s) => s.state === "paused").length;
  const dead = sessions.filter((s) => s.state === "dead").length;

  return NextResponse.json({
    sessions,
    stats: { total: sessions.length, running, paused, dead },
  });
}
