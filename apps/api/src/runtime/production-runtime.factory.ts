import OpenAI from 'openai';
import { createClient } from 'redis';
import { AgentLoopService, type AgentLoopLimits } from '../agent/agent-loop.service';
import { CompactSummaryPort } from '../context/compact-summary.port';
import { ContextSelectorService } from '../context/context-selector.service';
import { Utf8TokenCounter } from '../context/utf8-token-counter';
import type { ClockPort, McpToolClientPort, TurnTransactionPort } from '../domain/types';
import { OpenAiResponsesAdapter, type ResponsesStreamPort } from '../llm/openai-responses.adapter';
import { McpToolService } from '../mcp/mcp-tool.service';
import { StdioMcpClient } from '../mcp/stdio-mcp.client';
import {
  RedisConversationRepository,
  type RedisListPort,
} from '../storage/redis-conversation.repository';
import { RedisEventSink, type RedisStreamPort } from '../stream/redis-event.sink';
import { FileSystemArtifactStore } from './file-system-artifact.store';
import { RedisActiveTurnLock, type RedisLockPort } from './redis-active-turn-lock';
import { RedisTurnEventPublisher } from './redis-turn-event-publisher';
import { RedisTurnEventReader, type RedisRangePort } from './redis-turn-event.reader';
import {
  RuntimeCopilotApi,
  type AgentRunnerFactoryPort,
  type RuntimeKeyValuePort,
} from './runtime-copilot.api';
type RedisRuntimePort = RedisListPort &
  RedisStreamPort &
  RedisRangePort &
  RuntimeKeyValuePort &
  RedisLockPort & { connect(): Promise<void>; close(): Promise<void> };
export interface ProductionRuntime {
  readonly api: RuntimeCopilotApi;
  close(): Promise<void>;
}
export interface ProductionRuntimeOptions {
  readonly llmProvider: 'openai';
  readonly redisUrl: string;
  readonly openAiApiKey: string;
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly model: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
  readonly systemPrompt: string;
  readonly contextTokenBudget: number;
  readonly contextRecentExchanges: number;
  readonly agentLimits: AgentLoopLimits;
  readonly sessionTtlSeconds: number;
}
export async function createProductionRuntime(
  options: ProductionRuntimeOptions,
): Promise<ProductionRuntime> {
  const redis = createClient({ url: options.redisUrl }) as unknown as RedisRuntimePort;
  await redis.connect();
  const [search, writer] = await Promise.all([
    startMcp('search', 'apps/mcp-search/src/main.ts', options.workspaceRoot),
    startMcp('writer', 'apps/mcp-writer/src/main.ts', options.workspaceRoot),
  ]);
  const mcp = new McpToolService({ search, writer });
  const artifacts = new FileSystemArtifactStore(options.workspaceRoot, options.artifactRoot);
  const provider = new OpenAiResponsesAdapter(
    new OpenAI({ apiKey: options.openAiApiKey }).responses as unknown as ResponsesStreamPort,
    options.model,
    options.reasoningEffort,
  );
  return {
    api: new RuntimeCopilotApi(
      redis,
      new RedisConversationRepository(redis),
      new RedisTurnEventReader(redis),
      new ProductionAgentRunnerFactory(provider, mcp, redis, options.agentLimits, artifacts),
      new RedisActiveTurnLock(redis),
      new ContextSelectorService(
        new Utf8TokenCounter(),
        new CompactSummaryPort(),
        options.contextTokenBudget,
        options.contextRecentExchanges,
      ),
      artifacts,
      new RedisTurnEventPublisher(redis),
      options.sessionTtlSeconds,
      options.systemPrompt,
    ),
    close: async (): Promise<void> => {
      await Promise.allSettled([search.close(), writer.close()]);
      await redis.close();
    },
  };
}
class ProductionAgentRunnerFactory implements AgentRunnerFactoryPort {
  public constructor(
    private readonly provider: OpenAiResponsesAdapter,
    private readonly mcp: McpToolClientPort,
    private readonly redis: RedisStreamPort,
    private readonly limits: AgentLoopLimits,
    private readonly artifacts: FileSystemArtifactStore,
  ) {}
  create(turnId: string): AgentLoopService {
    return new AgentLoopService(
      this.provider,
      this.mcp,
      new RedisEventSink(this.redis, turnId),
      new McpTurnTransaction(this.mcp),
      new SystemClock(),
      this.limits,
      this.artifacts,
    );
  }
}
class McpTurnTransaction implements TurnTransactionPort {
  public constructor(private readonly mcp: McpToolClientPort) {}
  async commit(turnId: string): Promise<void> {
    await this.finish('commit_turn', turnId);
  }
  async rollback(turnId: string): Promise<void> {
    await this.finish('rollback_turn', turnId);
  }
  private async finish(name: 'commit_turn' | 'rollback_turn', turnId: string): Promise<void> {
    const result = await this.mcp.call({
      id: `${name}:${turnId}`,
      name,
      input: { turnId },
      server: 'writer',
    });
    if (result.isError)
      throw new Error(`Writer ${name} failed for turn ${turnId}: ${result.content}`);
  }
}
class SystemClock implements ClockPort {
  now(): number {
    return Date.now();
  }
}
function startMcp(
  name: string,
  entrypoint: string,
  workspaceRoot: string,
): Promise<StdioMcpClient> {
  return StdioMcpClient.start({
    name: `chat-app-${name}`,
    command: process.execPath,
    args: ['--import', 'tsx', entrypoint],
    environment: { ...environmentStrings(), WORKSPACE_ROOT: workspaceRoot },
  });
}
function environmentStrings(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
