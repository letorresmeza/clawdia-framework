import { NextResponse } from "next/server";
import { DashboardVersionConflictError } from "@/lib/dashboard-errors";

export function extractVersion(body: unknown) {
  if (!body || typeof body !== "object") {
    return { ok: false as const, response: NextResponse.json({ error: "request body must be an object" }, { status: 400 }) };
  }

  const candidate = body as Record<string, unknown>;
  if (typeof candidate.version !== "number" || !Number.isFinite(candidate.version)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "version is required" },
        { status: 400 }
      ),
    };
  }

  return { ok: true as const, version: candidate.version };
}

export function mutationErrorResponse(error: unknown) {
  if (error instanceof DashboardVersionConflictError) {
    return NextResponse.json(
      { error: error.message },
      { status: 409 }
    );
  }

  throw error;
}
