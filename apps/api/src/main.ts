import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { CopilotApiPort } from './http/copilot-api.port';
import {
  createProductionRuntime,
  type ProductionRuntimeOptions,
} from './runtime/production-runtime.factory';

const defaultSystemPrompt =
  'You are a careful codebase copilot. Inspect files before proposing changes, use tools when needed, and explain completed work concisely.';
export async function startApi(api: CopilotApiPort, port = 3001): Promise<void> {
  const app = await NestFactory.create(AppModule.register(api));
  await app.listen(port);
}
export async function startProductionApi(
  options: ProductionRuntimeOptions,
  port = 3001,
): Promise<void> {
  const runtime = await createProductionRuntime(options);
  const app = await NestFactory.create(AppModule.register(runtime.api));
  app.enableShutdownHooks();
  process.once('beforeExit', () => {
    void runtime.close();
  });
  await app.listen(port);
}
export function readProductionOptions(environment: NodeJS.ProcessEnv): ProductionRuntimeOptions {
  const agentLimits = readAgentLimits(environment);
  return {
    llmProvider: readLlmProvider(environment.LLM_PROVIDER),
    redisUrl: environment.REDIS_URL ?? 'redis://redis:6379',
    openAiApiKey: required(environment.OPENAI_API_KEY ?? environment.LLM_API_KEY),
    workspaceRoot: environment.WORKSPACE_ROOT ?? '/workspace',
    artifactRoot: environment.ARTIFACT_ROOT ?? '/artifacts',
    model: environment.OPENAI_MODEL ?? environment.LLM_MODEL ?? 'gpt-5.4-mini',
    reasoningEffort: reasoning(environment.LLM_REASONING_EFFORT),
    systemPrompt: environment.SYSTEM_PROMPT ?? defaultSystemPrompt,
    contextTokenBudget: positive(environment.CONTEXT_TOKEN_BUDGET, 32_768),
    contextRecentExchanges: positive(environment.CONTEXT_RECENT_EXCHANGES, 4),
    agentLimits,
    sessionTtlSeconds: activeSessionTtlSeconds(environment, agentLimits.turnTimeoutMs),
  };
}
function readAgentLimits(environment: NodeJS.ProcessEnv): ProductionRuntimeOptions['agentLimits'] {
  return {
    maxIterations: positive(environment.AGENT_MAX_ITERATIONS, 8),
    iterationTimeoutMs: positive(environment.LLM_ITERATION_TIMEOUT_MS, 90_000),
    toolTimeoutMs: positive(environment.MCP_TOOL_TIMEOUT_MS, 10_000),
    turnTimeoutMs: positive(environment.TURN_TIMEOUT_MS, 300_000),
  };
}
function activeSessionTtlSeconds(environment: NodeJS.ProcessEnv, turnTimeoutMs: number): number {
  const idleTtlMs = positive(environment.SESSION_IDLE_TTL_MS, 1_800_000);
  return Math.ceil(Math.max(idleTtlMs, turnTimeoutMs) / 1_000);
}
function required(value: string | undefined): string {
  if (!value) throw new Error('OPENAI_API_KEY or LLM_API_KEY must be configured');
  return value;
}
function reasoning(value: string | undefined): 'low' | 'medium' | 'high' {
  if (!value) return 'medium';
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new Error(`LLM_REASONING_EFFORT must be low, medium, or high; received "${value}"`);
}
function readLlmProvider(value: string | undefined): 'openai' {
  if (!value || value === 'openai') return 'openai';
  throw new Error(`LLM_PROVIDER must be "openai"; received "${value}"`);
}
function positive(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`Expected a positive integer environment value, received "${value}"`);
  return parsed;
}
if (require.main === module)
  void startProductionApi(readProductionOptions(process.env), Number(process.env.PORT ?? '3001'));
