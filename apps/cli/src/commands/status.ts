import chalk from "chalk";
import type { Command } from "commander";
import type { SessionState } from "@clawdia/types";
import type { AgentSpawner, ServiceRegistry } from "@clawdia/orchestrator";

export function registerStatusCommand(
  program: Command,
  services: {
    spawner: AgentSpawner;
    registry: ServiceRegistry;
  },
): void {
  program
    .command("status [session-id]")
    .description("Show session status (all sessions or a specific one)")
    .option("--state <state>", "Filter by session state")
    .action((sessionId: string | undefined, opts: { state?: string }) => {
      try {
        if (sessionId) {
          // Show specific session
          const session = services.spawner.get(sessionId);
          if (!session) {
            console.error(chalk.red("Error:"), `Session "${sessionId}" not found`);
            process.exitCode = 1;
            return;
          }

          console.log(chalk.bold("Session Details"));
          console.log(`  ID:              ${chalk.cyan(session.id)}`);
          console.log(`  Agent:           ${session.identity.displayName} ${chalk.dim(`(${session.identity.name})`)}`);
          console.log(`  State:           ${formatState(session.state)}`);
          console.log(`  Started:         ${session.startedAt}`);
          console.log(`  Last Heartbeat:  ${session.lastHeartbeat}`);
          console.log(`  Tasks Completed: ${session.tasksCompleted}`);
          console.log(`  Runtime:         ${session.runtimeHandle.runtime} ${chalk.dim(session.runtimeHandle.id)}`);

          if (session.activeContracts.length > 0) {
            console.log(`  Active Contracts: ${session.activeContracts.join(", ")}`);
          }

          if (session.error) {
            console.log(chalk.red(`  Error: [${session.error.code}] ${session.error.message}`));
          }
        } else {
          // List all sessions
          const filter = opts.state ? { state: opts.state as SessionState } : undefined;
          const sessions = services.spawner.list(filter);
          const registryStats = services.registry.stats();

          console.log(chalk.bold("Sessions"));
          if (sessions.length === 0) {
            console.log(chalk.dim("  No sessions found"));
          } else {
            for (const s of sessions) {
              console.log(
                `  ${chalk.cyan(s.id)}  ${s.identity.name.padEnd(20)}  ${formatState(s.state)}  tasks:${s.tasksCompleted}`,
              );
            }
          }

          console.log();
          console.log(chalk.bold("Registry"));
          console.log(`  Online: ${registryStats["online"] ?? 0}  Offline: ${registryStats["offline"] ?? 0}  Busy: ${registryStats["busy"] ?? 0}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red("Error:"), message);
        process.exitCode = 1;
      }
    });
}

function formatState(state: SessionState): string {
  switch (state) {
    case "running":
      return chalk.green(state);
    case "paused":
      return chalk.yellow(state);
    case "dead":
      return chalk.red(state);
    case "terminating":
      return chalk.red(state);
    default:
      return chalk.dim(state);
  }
}
