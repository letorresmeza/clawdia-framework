import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api-auth";
import { extractVersion, mutationErrorResponse } from "@/lib/api-version";
import { deleteAgent, getAgent, updateAgent } from "@/lib/dashboard-service";
import { validateUpdateAgent } from "@/lib/dashboard-validation";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSessionUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await params;
  const agent = await getAgent(decodeURIComponent(id));

  if (!agent) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  return NextResponse.json({ agent });
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

  const validated = validateUpdateAgent(body);

  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const agent = await updateAgent(decodeURIComponent(id), validated.value, {
      version: versionResult.version,
      actor: auth.user.username,
    });
    if (!agent) {
      return NextResponse.json({ error: "agent not found" }, { status: 404 });
    }

    return NextResponse.json({ agent });
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
    const deleted = await deleteAgent(decodeURIComponent(id), {
      version: versionResult.version,
      actor: auth.user.username,
    });

    if (!deleted) {
      return NextResponse.json({ error: "agent not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
