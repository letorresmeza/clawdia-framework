/**
 * Data Analyst Agent — example Clawdia agent using the SDK.
 *
 * Processes CSV and JSON data, computing statistics and identifying trends.
 * Simulated implementations suitable for demo/testing; replace with real
 * data processing libraries (e.g. danfo.js, arquero) in production.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent } from "@clawdia/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const soulMd = readFileSync(join(__dirname, "..", "soul.md"), "utf-8");

// ─── Task handlers ────────────────────────────────────────────────────────────

function analyzeCsv(input: unknown): unknown {
  const { csv_data, operations = ["describe"] } = input as {
    csv_data: string;
    operations?: string[];
    columns?: string[];
  };

  // Parse CSV (simplified parser — use papaparse in production)
  const lines = csv_data.trim().split("\n");
  const headers = (lines[0] ?? "").split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) =>
    line.split(",").map((v) => v.trim()),
  );

  const numericCols = headers.reduce<Record<string, number[]>>((acc, h, i) => {
    const vals = rows
      .map((r) => parseFloat(r[i] ?? ""))
      .filter((n) => !isNaN(n));
    if (vals.length > 0) acc[h] = vals;
    return acc;
  }, {});

  const statistics: Record<string, unknown> = {};
  for (const [col, vals] of Object.entries(numericCols)) {
    const sorted = [...vals].sort((a, b) => a - b);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    statistics[col] = {
      count: vals.length,
      mean: Math.round(mean * 100) / 100,
      median: sorted[Math.floor(sorted.length / 2)],
      std: Math.round(Math.sqrt(variance) * 100) / 100,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      nulls: rows.length - vals.length,
    };
  }

  const trends = operations.includes("trend")
    ? Object.entries(numericCols).map(([col, vals]) => ({
        column: col,
        direction: vals[vals.length - 1]! > vals[0]! ? "up" : vals[vals.length - 1]! < vals[0]! ? "down" : "flat",
        confidence: 0.75,
      }))
    : [];

  return {
    rows_analyzed: rows.length,
    columns_analyzed: headers.length,
    statistics,
    correlations: [],
    anomalies: [],
    trends,
    summary: `Analyzed ${rows.length} rows × ${headers.length} columns. Numeric columns: ${Object.keys(numericCols).join(", ")}.`,
  };
}

function analyzeJson(input: unknown): unknown {
  const { json_data, operations = ["aggregate"] } = input as {
    json_data: string;
    operations?: string[];
    schema?: unknown;
    extract_paths?: string[];
  };

  let parsed: unknown;
  let valid = true;
  const validationErrors: string[] = [];

  try {
    parsed = JSON.parse(json_data);
  } catch (e) {
    valid = false;
    validationErrors.push(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    parsed = null;
  }

  const isArray = Array.isArray(parsed);
  const recordCount = isArray ? (parsed as unknown[]).length : parsed !== null ? 1 : 0;

  const aggregations: Record<string, unknown> = {};
  if (operations.includes("aggregate") && isArray) {
    const arr = parsed as Record<string, unknown>[];
    const keys = arr.length > 0 ? Object.keys(arr[0] ?? {}) : [];
    for (const key of keys) {
      const vals = arr.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
      aggregations[key] = { count: vals.length, unique: new Set(vals).size };
    }
  }

  const structureSummary = isArray
    ? `Array of ${recordCount} objects`
    : typeof parsed === "object" && parsed !== null
      ? `Object with ${Object.keys(parsed as object).length} keys`
      : `Scalar value (${typeof parsed})`;

  return {
    valid,
    validation_errors: validationErrors,
    aggregations,
    extracted: [],
    structure_summary: structureSummary,
    record_count: recordCount,
  };
}

// ─── Agent factory ────────────────────────────────────────────────────────────

export async function startDataAnalyst(
  ...args: Parameters<typeof createAgent>
): ReturnType<typeof createAgent> {
  const [opts] = args;
  return createAgent({
    ...opts,
    soulMd,
    async onTask({ input, contract, ctx }) {
      ctx.log(`Analyzing data: ${contract.capability}`);

      switch (contract.capability) {
        case "analysis.data.csv":
          return analyzeCsv(input);
        case "analysis.data.json":
          return analyzeJson(input);
        default:
          throw new Error(`Unknown capability: ${contract.capability}`);
      }
    },
  });
}

// ─── Standalone runner ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { InMemoryBus, ContractEngine } = await import("@clawdia/core");
  const { ServiceRegistry } = await import("@clawdia/orchestrator");

  const bus = new InMemoryBus();
  await bus.connect();

  const agent = await createAgent({
    soulMd,
    bus,
    registry: new ServiceRegistry(bus),
    contracts: new ContractEngine(bus),
    async onTask({ input, contract, ctx }) {
      ctx.log(`Analyzing data: ${contract.capability}`);
      switch (contract.capability) {
        case "analysis.data.csv": return analyzeCsv(input);
        case "analysis.data.json": return analyzeJson(input);
        default: throw new Error(`Unknown capability: ${contract.capability}`);
      }
    },
  });

  console.log(`[data-analyst] Online — ${agent.identity.capabilities.length} capabilities`);

  process.on("SIGINT", async () => { await agent.stop(); process.exit(0); });
  process.on("SIGTERM", async () => { await agent.stop(); process.exit(0); });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) main().catch(console.error);
