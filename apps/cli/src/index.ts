#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { InMemoryBus, NatsBus, IdentityRuntime } from "@clawdia/core";
import type { IClawBus } from "@clawdia/core";
import type { IRuntimeProvider } from "@clawdia/types";
import { ServiceRegistry, AgentSpawner } from "@clawdia/orchestrator";
import { DockerRuntimeProvider } from "@clawdia/plugin-runtime-docker";
import { InMemoryRuntimeProvider } from "./runtime/in-memory-runtime.js";
import { registerSpawnCommand } from "./commands/spawn.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerSendCommand } from "./commands/send.js";
import { registerRegistryCommand } from "./commands/registry.js";
import { registerPublishCommand } from "./commands/publish.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerHireCommand } from "./commands/hire.js";
import { loadConfig } from "./config.js";
import { ContractEngine } from "@clawdia/core";

const program = new Command();

program
  .name("clawdia")
  .description("Clawdia Framework — agent infrastructure for the autonomous economy")
  .version("0.1.0")
  .option("--config <path>", "Path to clawdia.yaml config file")
  .option("--bus <type>", "Bus type: nats or in-memory (overrides config)")
  .option("--runtime <type>", "Runtime type: docker or in-memory (overrides config)");

async function main(): Promise<void> {
  // Pre-parse to get global options before commands run
  program.parseOptions(process.argv);
  const opts = program.opts<{ config?: string; bus?: string; runtime?: string }>();

  const config = loadConfig(opts.config);

  // Allow CLI flags to override config
  const busType = opts.bus ?? config.defaults.bus;
  const runtimeType = opts.runtime ?? config.defaults.runtime;

  // Create bus
  let bus: IClawBus;
  if (busType === "nats") {
    bus = new NatsBus();
  } else {
    bus = new InMemoryBus();
  }

  // Create runtime provider
  let runtimeProvider: IRuntimeProvider;
  if (runtimeType === "docker") {
    runtimeProvider = new DockerRuntimeProvider();
  } else {
    runtimeProvider = new InMemoryRuntimeProvider();
  }

  const identityRuntime = new IdentityRuntime();
  const registry = new ServiceRegistry(bus, {
    healthCheckIntervalMs: config.registry.healthCheckIntervalMs,
    deregisterAfterMs: config.registry.deregisterAfterMs,
  });
  const spawner = new AgentSpawner(runtimeProvider, bus, {
    heartbeatIntervalMs: runtimeType === "in-memory" ? 2_147_483_647 : 30_000,
  });
  const contracts = new ContractEngine(bus);

  // Register commands
  registerSpawnCommand(program, { identityRuntime, registry, spawner });
  registerStatusCommand(program, { spawner, registry });
  registerSendCommand(program, { bus, spawner });
  registerRegistryCommand(program, { registry });
  registerPublishCommand(program, { identityRuntime, registry });
  registerSearchCommand(program, { registry });
  registerHireCommand(program, { bus, registry, contracts });

  // Connect bus
  if (busType === "nats") {
    console.log(chalk.dim(`Connecting to NATS at ${config.nats.url}...`));
    await bus.connect(config.nats.url);
  } else {
    await bus.connect();
  }

  console.log(chalk.dim(`Bus: ${busType}  Runtime: ${runtimeType}`));

  await program.parseAsync(process.argv);

  // Cleanup
  await spawner.destroyAll();
  registry.destroy();
  await bus.disconnect();
}

main().catch((err) => {
  console.error(chalk.red("Fatal:"), err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
