import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function requireSessionUser() {
  const session = await getSessionUser();

  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "authentication required" }, { status: 401 }),
    };
  }

  return {
    ok: true as const,
    user: session,
  };
}
