import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api-auth";
import { extractVersion, mutationErrorResponse } from "@/lib/api-version";
import { createEvent, listEvents } from "@/lib/dashboard-service";
import { validateCreateEvent } from "@/lib/dashboard-validation";

export async function GET() {
  const auth = await requireSessionUser();
  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json({ events: await listEvents() });
}

export async function POST(request: NextRequest) {
  const auth = await requireSessionUser();
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json();
  const versionResult = extractVersion(body);
  if (!versionResult.ok) {
    return versionResult.response;
  }

  const validated = validateCreateEvent(body);

  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const event = await createEvent(validated.value, {
      version: versionResult.version,
      actor: auth.user.username,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
