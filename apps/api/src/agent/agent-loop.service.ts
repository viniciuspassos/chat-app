import type { CanonicalDelta, ContentBlock } from '@chat-app/contracts';
import { BlockAssembler } from '../domain/block-assembler';
import type { ArtifactSnapshot, ArtifactSnapshotPort } from '../runtime/artifact-snapshot.port';
import type {
  ClockPort,
  ConversationExchange,
  LlmMessage,
  LlmProviderPort,
  McpToolCall,
  McpToolClientPort,
  McpToolResult,
  TurnEventSink,
  TurnTransactionPort,
} from '../domain/types';

type ToolUseBlock = Extract<ContentBlock, { readonly type: 'tool_use' }>;
export interface AgentTurnInput {
  readonly turnId: string;
  readonly sessionId: string;
  readonly userMessage: string;
  readonly messages: readonly LlmMessage[];
}
export interface AgentLoopLimits {
  readonly maxIterations: number;
  readonly iterationTimeoutMs: number;
  readonly toolTimeoutMs: number;
  readonly turnTimeoutMs: number;
}
export const defaultAgentLoopLimits: AgentLoopLimits = {
  maxIterations: 8,
  iterationTimeoutMs: 90_000,
  toolTimeoutMs: 10_000,
  turnTimeoutMs: 300_000,
};
export class PublishedAgentTurnError extends Error {
  public constructor(error: unknown) {
    super(error instanceof Error ? error.message : 'Turn failed');
    this.name = 'PublishedAgentTurnError';
  }
}

export class AgentLoopService {
  public constructor(
    private readonly llm: LlmProviderPort,
    private readonly mcp: McpToolClientPort,
    private readonly sink: TurnEventSink,
    private readonly transaction: TurnTransactionPort,
    private readonly clock: ClockPort,
    private readonly limits: AgentLoopLimits = defaultAgentLoopLimits,
    private readonly artifacts?: ArtifactSnapshotPort,
  ) {}

  async run(input: AgentTurnInput): Promise<ConversationExchange> {
    const deadline = this.clock.now() + this.limits.turnTimeoutMs;
    const history = [...input.messages, { role: 'user' as const, content: input.userMessage }];
    const blocks: ContentBlock[] = [];
    try {
      for (let iteration = 0; iteration < this.limits.maxIterations; iteration += 1) {
        this.assertBeforeDeadline(deadline);
        if ((await this.runIteration(history, blocks, deadline, input.turnId)) === 'end_turn')
          return this.complete(input, blocks);
      }
      throw new Error(`Turn exceeded ${this.limits.maxIterations} iterations`);
    } catch (error) {
      await this.transaction.rollback(input.turnId);
      await this.publishError(error);
      throw new PublishedAgentTurnError(error);
    }
  }

  private async runIteration(
    history: LlmMessage[],
    blocks: ContentBlock[],
    deadline: number,
    turnId: string,
  ): Promise<'tool_use' | 'end_turn'> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error('LLM iteration timed out')),
      this.iterationTimeout(deadline),
    );
    const assembler = new BlockAssembler();
    let stopReason: 'tool_use' | 'end_turn' | undefined;
    try {
      const tools = await this.mcp.listTools();
      for await (const delta of this.llm.stream({ messages: history, tools }, controller.signal)) {
        assembler.accept(delta);
        await this.publishCanonicalDelta(delta);
        if (delta.type === 'message_delta') stopReason = delta.stopReason;
      }
    } finally {
      clearTimeout(timeout);
    }
    if (!stopReason) throw new Error('LLM stream ended without a stop reason');
    const iterationBlocks = assembler.blocks();
    blocks.push(...iterationBlocks);
    history.push(...iterationBlocks.map(toAssistantMessage));
    if (stopReason === 'end_turn') return stopReason;
    const toolBlocks = iterationBlocks.filter(isToolUse);
    if (toolBlocks.length === 0)
      throw new Error('LLM requested tools without emitting a tool block');
    const results = await this.executeTools(toolBlocks, turnId, deadline);
    blocks.push(...results.blocks);
    history.push(...results.messages);
    return stopReason;
  }

  private iterationTimeout(deadline: number): number {
    return Math.max(1, Math.min(this.limits.iterationTimeoutMs, deadline - this.clock.now()));
  }
  private async executeTools(
    tools: readonly ToolUseBlock[],
    turnId: string,
    deadline: number,
  ): Promise<{ blocks: ContentBlock[]; messages: LlmMessage[] }> {
    const indexed = tools.map((tool, index) => ({ tool, index }));
    const results = new Map<number, ContentBlock>();
    const run = async ({ tool, index }: { tool: ToolUseBlock; index: number }): Promise<void> => {
      results.set(index, await this.executeTool(tool, turnId, deadline));
    };
    await Promise.all(indexed.filter(({ tool }) => tool.server === 'search').map(run));
    for (const item of indexed.filter(({ tool }) => tool.server === 'writer')) await run(item);
    const blocks = indexed.map(({ index }) => results.get(index)).filter(isContentBlock);
    return { blocks, messages: blocks.map(toToolMessage) };
  }

  private async executeTool(
    tool: ToolUseBlock,
    turnId: string,
    deadline: number,
  ): Promise<ContentBlock> {
    await this.publishToolStatus(tool, 'running');
    const result = await this.callToolWithTimeout(tool, turnId, deadline);
    await this.publishToolStatus(tool, result.isError ? 'error' : 'done');
    return toolResultBlock(tool, result);
  }
  private async callToolWithTimeout(
    tool: ToolUseBlock,
    turnId: string,
    deadline: number,
  ): Promise<McpToolResult> {
    try {
      return await runWithTimeout(
        this.mcp.call(toMcpCall(tool, turnId)),
        this.toolTimeout(deadline),
        `Tool ${tool.name}`,
      );
    } catch (error) {
      await this.publishToolStatus(tool, 'error');
      throw error;
    }
  }
  private toolTimeout(deadline: number): number {
    const remaining = deadline - this.clock.now();
    if (remaining <= 0) throw new Error('Turn timed out');
    if (this.limits.toolTimeoutMs < 1)
      throw new Error(`Tool timeout must be positive, received ${this.limits.toolTimeoutMs}`);
    return Math.min(this.limits.toolTimeoutMs, remaining);
  }
  private async publishToolStatus(
    tool: ToolUseBlock,
    status: 'running' | 'done' | 'error',
  ): Promise<void> {
    await this.sink.publish({
      type: 'tool',
      toolUseId: tool.id,
      name: tool.name,
      server: tool.server,
      status,
    });
  }
  private async publishCanonicalDelta(delta: CanonicalDelta): Promise<void> {
    await this.sink.publish({ type: 'canonical_delta', delta });
    if (delta.type === 'text_delta')
      await this.sink.publish({ type: 'text', blockIndex: delta.index, delta: delta.delta });
  }
  private async complete(
    input: AgentTurnInput,
    blocks: readonly ContentBlock[],
  ): Promise<ConversationExchange> {
    await this.transaction.commit(input.turnId);
    const artifacts = await this.snapshotGeneratedFiles(input.sessionId, blocks);
    for (const artifact of artifacts) await this.publishArtifact(artifact);
    return {
      id: input.turnId,
      userMessage: input.userMessage,
      blocks: [...blocks, ...artifacts.map(toFileBlock)],
    };
  }
  private async snapshotGeneratedFiles(
    sessionId: string,
    blocks: readonly ContentBlock[],
  ): Promise<ArtifactSnapshot[]> {
    if (!this.artifacts) return [];
    const paths = completedWriterPaths(blocks);
    const snapshots: ArtifactSnapshot[] = [];
    for (const path of paths) snapshots.push(await this.artifacts.snapshot(sessionId, path));
    return snapshots;
  }
  private async publishArtifact(artifact: ArtifactSnapshot): Promise<void> {
    await this.sink.publish({
      type: 'file',
      artifactId: artifact.id,
      path: artifact.path,
      downloadUrl: artifact.downloadUrl,
    });
  }
  private assertBeforeDeadline(deadline: number): void {
    if (this.clock.now() >= deadline) throw new Error('Turn timed out');
  }
  private async publishError(error: unknown): Promise<void> {
    await this.sink.publish({
      type: 'error',
      code: 'turn_failed',
      message: error instanceof Error ? error.message : 'Turn failed',
    });
  }
}
function isToolUse(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use';
}
function isContentBlock(value: ContentBlock | undefined): value is ContentBlock {
  return value !== undefined;
}
function toMcpCall(block: ToolUseBlock, turnId: string): McpToolCall {
  return {
    id: block.id,
    name: block.name,
    input: block.server === 'writer' ? { ...block.input, turnId } : block.input,
    server: block.server,
  };
}
function toolResultBlock(tool: ToolUseBlock, result: McpToolResult): ContentBlock {
  return {
    type: 'tool_result',
    toolUseId: tool.id,
    content: result.content,
    isError: result.isError,
  };
}
function completedWriterPaths(blocks: readonly ContentBlock[]): string[] {
  const results = new Map(
    blocks.filter((block) => block.type === 'tool_result').map((block) => [block.toolUseId, block]),
  );
  const paths = new Set<string>();
  for (const block of blocks) {
    if (block.type !== 'tool_use') continue;
    if (!isCompletedWriterFile(block, results.get(block.id))) continue;
    paths.add(block.input.path);
  }
  return [...paths];
}
function isCompletedWriterFile(
  block: ToolUseBlock,
  result: ContentBlock | undefined,
): block is ToolUseBlock & { readonly input: { readonly path: string } } {
  return (
    block.server === 'writer' &&
    (block.name === 'write_file' || block.name === 'commit_write') &&
    typeof block.input.path === 'string' &&
    result?.type === 'tool_result' &&
    !result.isError
  );
}
function toFileBlock(artifact: ArtifactSnapshot): ContentBlock {
  return {
    type: 'file',
    id: artifact.id,
    path: artifact.path,
    name: artifact.name,
    mediaType: artifact.mediaType,
    downloadUrl: artifact.downloadUrl,
  };
}
function toToolMessage(block: ContentBlock): LlmMessage {
  if (block.type !== 'tool_result')
    throw new Error(`Expected tool result but received ${block.type}`);
  return { role: 'tool', callId: block.toolUseId, content: block.content };
}
function toAssistantMessage(block: ContentBlock): LlmMessage {
  if (block.type === 'tool_use')
    return {
      role: 'assistant',
      content: '',
      functionCall: { id: block.id, name: block.name, arguments: JSON.stringify(block.input) },
    };
  return { role: 'assistant', content: block.type === 'text' ? block.text : JSON.stringify(block) };
}
function runWithTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    operation.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error('Tool operation failed'));
      },
    );
  });
}
