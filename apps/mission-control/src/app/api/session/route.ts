import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const session = await getSessionUser();

  if (!session) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  return NextResponse.json({ user: session });
}
