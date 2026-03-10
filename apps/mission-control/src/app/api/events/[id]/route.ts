import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api-auth";
import { extractVersion, mutationErrorResponse } from "@/lib/api-version";
import { deleteEvent, getEvent, updateEvent } from "@/lib/dashboard-service";
import { validateUpdateEvent } from "@/lib/dashboard-validation";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSessionUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await params;
  const event = await getEvent(decodeURIComponent(id));

  if (!event) {
    return NextResponse.json({ error: "event not found" }, { status: 404 });
  }

  return NextResponse.json({ event });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSessionUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await params;
  const body = await request.json();
  const versionResult = extractVersion(body);
  if (!versionResult.ok) {
    return versionResult.response;
  }

  const validated = validateUpdateEvent(body);

  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const event = await updateEvent(decodeURIComponent(id), validated.value, {
      version: versionResult.version,
      actor: auth.user.username,
    });
    if (!event) {
      return NextResponse.json({ error: "event not found" }, { status: 404 });
    }

    return NextResponse.json({ event });
  } catch (error) {
    return mutationErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSessionUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await params;
  const body = await request.json();
  const versionResult = extractVersion(body);
  if (!versionResult.ok) {
    return versionResult.response;
  }

  try {
    const deleted = await deleteEvent(decodeURIComponent(id), {
      version: versionResult.version,
      actor: auth.user.username,
    });

    if (!deleted) {
      return NextResponse.json({ error: "event not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
