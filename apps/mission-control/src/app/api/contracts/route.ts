import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api-auth";
import { extractVersion, mutationErrorResponse } from "@/lib/api-version";
import { createContract, listContracts } from "@/lib/dashboard-service";
import { validateCreateContract } from "@/lib/dashboard-validation";

export async function GET() {
  const auth = await requireSessionUser();
  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json({ contracts: await listContracts() });
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

  const validated = validateCreateContract(body);

  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const contract = await createContract(validated.value, {
      version: versionResult.version,
      actor: auth.user.username,
    });
    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
