import { NextResponse } from "next/server";
import { getEngines } from "@/lib/engines";
import type { SessionsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<SessionsResponse>> {
  const { spawner } = await getEngines();
  const sessions = spawner.list();
  const running = sessions.filter((s) => s.state === "running").length;
  const paused = sessions.filter((s) => s.state === "paused").length;
  const dead = sessions.filter((s) => s.state === "dead").length;

  return NextResponse.json({
    sessions,
    stats: { total: sessions.length, running, paused, dead },
  });
}
