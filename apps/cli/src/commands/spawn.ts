import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import type { IdentityRuntime } from "@clawdia/core";
import type { ServiceRegistry, AgentSpawner } from "@clawdia/orchestrator";

export function registerSpawnCommand(
  program: Command,
  services: {
    identityRuntime: IdentityRuntime;
    registry: ServiceRegistry;
    spawner: AgentSpawner;
  },
): void {
  program
    .command("spawn <soul-md>")
    .description("Register an agent from a soul.md manifest and spawn a session")
    .action(async (soulMdPath: string) => {
      try {
        const fullPath = resolve(soulMdPath);
        const content = readFileSync(fullPath, "utf-8");

        // Register identity
        const identity = await services.identityRuntime.register(content);
        console.log(chalk.green("Identity registered:"), identity.displayName, chalk.dim(`(${identity.name})`));

        // Register in service registry
        const session = await services.spawner.spawn({ identity });
        services.registry.register(identity, session.id);

        console.log(chalk.green("Session spawned:"));
        console.log(`  ID:       ${chalk.cyan(session.id)}`);
        console.log(`  Agent:    ${identity.displayName} ${chalk.dim(`v${identity.version}`)}`);
        console.log(`  State:    ${chalk.yellow(session.state)}`);
        console.log(`  Runtime:  ${session.runtimeHandle.runtime}`);
        console.log(`  Started:  ${session.startedAt}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red("Error:"), message);
        process.exitCode = 1;
      }
    });
}
