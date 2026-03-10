import type { RegistryEntry, TaskContract } from "@clawdia/types";

const DEFAULT_DAEMON_BASE_URL = "http://127.0.0.1:3001";

function getDaemonBaseUrl(): string {
  return process.env["CLAWDIA_DAEMON_URL"] ?? DEFAULT_DAEMON_BASE_URL;
}

function getApiKey(): string | undefined {
  return process.env["CLAWDIA_API_KEY"];
}

export class DaemonUnavailableError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DaemonUnavailableError";
  }
}

export async function fetchDaemonJson<T>(
  path: string,
  opts: { method?: "GET" | "POST"; body?: unknown; requireAuth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (opts.requireAuth !== false) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new DaemonUnavailableError(
        "CLAWDIA_API_KEY is not configured for the dashboard process",
      );
    }
    headers["X-API-Key"] = apiKey;
  }

  const response = await fetch(new URL(path, getDaemonBaseUrl()), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new DaemonUnavailableError(
      `Daemon request failed for ${path}: ${message || response.statusText}`,
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

export async function fetchRegistryEntries(): Promise<RegistryEntry[]> {
  return fetchDaemonJson<RegistryEntry[]>("/api/agents");
}

export async function fetchContracts(): Promise<TaskContract[]> {
  return fetchDaemonJson<TaskContract[]>("/api/contracts");
}
