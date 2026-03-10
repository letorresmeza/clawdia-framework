import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api-auth";
import { extractVersion, mutationErrorResponse } from "@/lib/api-version";
import { createTask, listTasks } from "@/lib/dashboard-service";
import { validateCreateTask } from "@/lib/dashboard-validation";

export async function GET() {
  const auth = await requireSessionUser();
  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json({ tasks: await listTasks() });
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

  const validated = validateCreateTask(body);

  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const task = await createTask(validated.value, {
      version: versionResult.version,
      actor: auth.user.username,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
