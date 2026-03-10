import { createAgent, type AgentHandle, type CreateAgentOptions, type HireResult } from "./create-agent.js";

export interface WorkflowAgentStep {
  agentName: string;
  capability: string;
  payment: { amount: number; currency: string };
  mapInput?: (input: unknown, previousResults: HireResult[]) => unknown;
}

export interface CreateWorkflowAgentOptions
  extends Omit<CreateAgentOptions, "onTask"> {
  steps: WorkflowAgentStep[];
}

export async function createWorkflowAgent(
  opts: CreateWorkflowAgentOptions,
): Promise<AgentHandle> {
  return createAgent({
    ...opts,
    async onTask({ input, ctx }) {
      const results: HireResult[] = [];
      let currentInput = input;

      for (const step of opts.steps) {
        const result = await ctx.hire({
          agentName: step.agentName,
          capability: step.capability,
          input: step.mapInput ? step.mapInput(currentInput, results) : currentInput,
          payment: step.payment,
        });
        results.push(result);
        currentInput = result.output;
      }

      return {
        workflowResults: results.map((result) => ({
          contractId: result.contractId,
          durationMs: result.durationMs,
          output: result.output,
        })),
        finalOutput: results.at(-1)?.output ?? input,
      };
    },
  });
}
