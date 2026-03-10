import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api-auth";
import { getDashboardData } from "@/lib/dashboard-service";

export async function GET() {
  const auth = await requireSessionUser();
  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json(await getDashboardData());
}
