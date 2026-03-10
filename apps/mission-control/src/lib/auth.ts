import crypto from "node:crypto";
import { cookies } from "next/headers";

export const sessionCookieName = "mission_control_session";

const fallbackUsername = "admin";
const fallbackPassword = "mission-control";
const fallbackSecret = "mission-control-dev-secret";

function credentialUsername() {
  return process.env.MISSION_CONTROL_USERNAME ?? fallbackUsername;
}

function credentialPassword() {
  return process.env.MISSION_CONTROL_PASSWORD ?? fallbackPassword;
}

function sessionSecret() {
  return process.env.MISSION_CONTROL_SESSION_SECRET ?? fallbackSecret;
}

function sign(value: string) {
  return crypto
    .createHmac("sha256", sessionSecret())
    .update(value)
    .digest("hex");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

export function verifyCredentials(username: string, password: string) {
  return (
    safeEqual(username, credentialUsername()) &&
    safeEqual(password, credentialPassword())
  );
}

export function createSessionValue(username: string) {
  const payload = `${username}:${sign(username)}`;
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function parseSessionValue(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const [username, signature] = decoded.split(":");

    if (!username || !signature || !safeEqual(signature, sign(username))) {
      return null;
    }

    return { username };
  } catch {
    return null;
  }
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const value = cookieStore.get(sessionCookieName)?.value;
  return parseSessionValue(value);
}
