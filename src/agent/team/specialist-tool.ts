import type { ApprovalPort } from '../../ports/approval.js';
import type { LlmClient, ToolDefinition } from '../../ports/llm-client.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { Tool } from '../../tools/types.js';
import { runAgent } from '../loop.js';

export interface SpecialistToolOptions {
  readonly name: string;
  readonly description: string;
  readonly role: string;
  readonly instructions: string;
  readonly tools: ToolRegistry;
  readonly llm: LlmClient;
  readonly approval?: ApprovalPort;
  readonly maxSteps?: number;
  readonly maxTokens?: number;
  readonly paramName?: string;
}

export function createSpecialistTool(options: SpecialistToolOptions): Tool {
  const paramName = options.paramName ?? 'demande';
  const parameters: Record<string, unknown> = {
    type: 'object',
    properties: {
      [paramName]: {
        type: 'string',
        description: `Demande pour ${options.role}`,
      },
    },
    required: [paramName],
  };

  return {
    name: options.name,
    description: options.description,
    parameters,
    toDefinition(): ToolDefinition {
      return {
        type: 'function',
        function: {
          name: options.name,
          description: options.description,
          parameters,
        },
      };
    },
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const detailed = await this.executeDetailed!(args);
      return detailed.result;
    },
    async executeDetailed(args: unknown) {
      if (
        typeof args !== 'object' ||
        args === null ||
        !(paramName in args) ||
        typeof (args as Record<string, unknown>)[paramName] !== 'string' ||
        ((args as Record<string, unknown>)[paramName] as string).trim().length === 0
      ) {
        return {
          result: {
            erreur: 'argument invalide',
            conseil: `fournir un argument texte "${paramName}" non vide`,
          },
        };
      }

      const userMessage = ((args as Record<string, unknown>)[paramName] as string).trim();

      const specialistResult = await runAgent({
        llm: options.llm,
        tools: options.tools,
        instructions: options.instructions,
        userMessage,
        history: [],
        role: options.role,
        approval: options.approval,
        maxSteps: options.maxSteps ?? 6,
        maxTokens: options.maxTokens,
        evaluate: undefined,
        maxEvaluationRetries: 0,
      });

      let result: Record<string, unknown>;
      if (specialistResult.stopReason === 'answered') {
        result = { resume: specialistResult.reply };
      } else {
        result = {
          erreur: `${options.role} n'a pas pu répondre`,
          conseil:
            "reformuler la demande ou informer le client que l'information est momentanément indisponible",
        };
      }

      const traceEvents = specialistResult.trace.map((e) => ({
        ...e,
        agent: e.agent || options.role,
      }));

      return {
        result,
        nested: {
          traceEvents,
          llmCalls: specialistResult.llmCalls,
          usage: specialistResult.usage,
          toolNames: specialistResult.toolNames,
        },
      };
    },
  };
}
