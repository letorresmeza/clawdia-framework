import { NextRequest, NextResponse } from "next/server";
import { createSessionValue, sessionCookieName, verifyCredentials } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    username?: string;
    password?: string;
  };

  if (!body.username || !body.password) {
    return NextResponse.json(
      { error: "username and password are required" },
      { status: 400 }
    );
  }

  if (!verifyCredentials(body.username, body.password)) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const response = NextResponse.json({
    user: { username: body.username },
  });

  response.cookies.set({
    name: sessionCookieName,
    value: createSessionValue(body.username),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}
