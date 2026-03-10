import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface ClawdiaConfig {
  nats: {
    url: string;
    jetstream: {
      enabled: boolean;
      streamName: string;
      subjectPattern: string;
      consumerPrefix: string;
      ackWaitMs: number;
      maxDeliver: number;
    };
  };
  defaults: {
    runtime: "docker" | "in-memory";
    bus: "nats" | "in-memory";
  };
  registry: {
    healthCheckIntervalMs: number;
    deregisterAfterMs: number;
  };
}

const DEFAULT_CONFIG: ClawdiaConfig = {
  nats: {
    url: "nats://localhost:4222",
    jetstream: {
      enabled: false,
      streamName: "CLAWDIA",
      subjectPattern: ">",
      consumerPrefix: "clawdia",
      ackWaitMs: 30_000,
      maxDeliver: 5,
    },
  },
  defaults: {
    runtime: "in-memory",
    bus: "in-memory",
  },
  registry: {
    healthCheckIntervalMs: 30_000,
    deregisterAfterMs: 120_000,
  },
};

/**
 * Load clawdia.yaml from the current working directory or ancestors.
 * Falls back to defaults if no config file is found.
 */
export function loadConfig(configPath?: string): ClawdiaConfig {
  const filePath = configPath ?? findConfigFile();
  if (!filePath) {
    return DEFAULT_CONFIG;
  }

  const content = readFileSync(filePath, "utf-8");
  const raw = parseYaml(content) as Record<string, unknown>;

  const natsRaw = raw["nats"] as Record<string, unknown> | undefined;
  const defaultsRaw = raw["defaults"] as Record<string, unknown> | undefined;
  const registryRaw = raw["registry"] as Record<string, unknown> | undefined;
  const jetstreamRaw =
    typeof natsRaw?.["jetstream"] === "object" && natsRaw?.["jetstream"] !== null
      ? (natsRaw["jetstream"] as Record<string, unknown>)
      : undefined;
  const jetstreamEnabled =
    typeof natsRaw?.["jetstream"] === "boolean"
      ? (natsRaw["jetstream"] as boolean)
      : ((jetstreamRaw?.["enabled"] as boolean | undefined) ?? DEFAULT_CONFIG.nats.jetstream.enabled);

  // Derive bus choice: if defaults.bus is set explicitly use it,
  // otherwise if nats config exists default to nats
  let busChoice: "nats" | "in-memory" = DEFAULT_CONFIG.defaults.bus;
  if (defaultsRaw?.["bus"] === "nats" || defaultsRaw?.["bus"] === "in-memory") {
    busChoice = defaultsRaw["bus"] as "nats" | "in-memory";
  } else if (natsRaw?.["url"]) {
    busChoice = "nats";
  }

  return {
    nats: {
      url: (natsRaw?.["url"] as string) ?? DEFAULT_CONFIG.nats.url,
      jetstream: {
        enabled: jetstreamEnabled,
        streamName:
          (jetstreamRaw?.["streamName"] as string) ?? DEFAULT_CONFIG.nats.jetstream.streamName,
        subjectPattern:
          (jetstreamRaw?.["subjectPattern"] as string) ??
          DEFAULT_CONFIG.nats.jetstream.subjectPattern,
        consumerPrefix:
          (jetstreamRaw?.["consumerPrefix"] as string) ??
          DEFAULT_CONFIG.nats.jetstream.consumerPrefix,
        ackWaitMs:
          (jetstreamRaw?.["ackWaitMs"] as number) ?? DEFAULT_CONFIG.nats.jetstream.ackWaitMs,
        maxDeliver:
          (jetstreamRaw?.["maxDeliver"] as number) ?? DEFAULT_CONFIG.nats.jetstream.maxDeliver,
      },
    },
    defaults: {
      runtime:
        (defaultsRaw?.["runtime"] as "docker" | "in-memory") ?? DEFAULT_CONFIG.defaults.runtime,
      bus: busChoice,
    },
    registry: {
      healthCheckIntervalMs:
        (registryRaw?.["healthCheckIntervalMs"] as number) ??
        DEFAULT_CONFIG.registry.healthCheckIntervalMs,
      deregisterAfterMs:
        (registryRaw?.["deregisterAfterMs"] as number) ?? DEFAULT_CONFIG.registry.deregisterAfterMs,
    },
  };
}

function findConfigFile(): string | undefined {
  const candidates = [resolve("clawdia.yaml"), resolve("clawdia.yml")];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}
