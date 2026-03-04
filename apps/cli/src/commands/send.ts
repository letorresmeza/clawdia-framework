import chalk from "chalk";
import type { Command } from "commander";
import type { IClawBus } from "@clawdia/core";
import type { AgentSpawner } from "@clawdia/orchestrator";

export function registerSendCommand(
  program: Command,
  services: {
    bus: IClawBus;
    spawner: AgentSpawner;
  },
): void {
  program
    .command("send <session-id> <message>")
    .description("Send a message to a running agent session via ClawBus")
    .action(async (sessionId: string, message: string) => {
      try {
        const session = services.spawner.get(sessionId);
        if (!session) {
          console.error(chalk.red("Error:"), `Session "${sessionId}" not found`);
          process.exitCode = 1;
          return;
        }

        if (session.state !== "running") {
          console.error(chalk.red("Error:"), `Session is not running (state: ${session.state})`);
          process.exitCode = 1;
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(message);
        } catch {
          // Treat as plain text message
          payload = { message };
        }

        const messageId = await services.bus.publish(
          "task.request",
          payload,
          session.identity,
          { recipient: session.identity.name },
        );

        console.log(chalk.green("Message sent"));
        console.log(`  ID:       ${chalk.cyan(messageId)}`);
        console.log(`  Session:  ${sessionId}`);
        console.log(`  Agent:    ${session.identity.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red("Error:"), msg);
        process.exitCode = 1;
      }
    });
}
