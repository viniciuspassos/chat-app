import { describe, expect, it } from 'vitest';
import { AgentLoopService, PublishedAgentTurnError } from '../src/agent/agent-loop.service';
import type {
  ClockPort,
  LlmProviderPort,
  LlmToolDefinition,
  LlmTurnRequest,
  McpToolCall,
  McpToolClientPort,
  McpToolResult,
  TurnEventSink,
  TurnTransactionPort,
} from '../src/domain/types';
import type { CanonicalDelta, InternalTurnEvent } from '@chat-app/contracts';
import type { ArtifactSnapshot, ArtifactSnapshotPort } from '../src/runtime/artifact-snapshot.port';

const limits = {
  maxIterations: 3,
  iterationTimeoutMs: 1_000,
  toolTimeoutMs: 1_000,
  turnTimeoutMs: 5_000,
};
const input = {
  turnId: 'turn-1',
  sessionId: 'session-1',
  userMessage: 'Create the report',
  messages: [],
};
const noTools: readonly LlmToolDefinition[] = [];

class ScriptedLlm implements LlmProviderPort {
  public readonly requests: LlmTurnRequest[] = [];
  public constructor(private readonly scripts: readonly (readonly CanonicalDelta[] | Error)[]) {}

  stream(request: LlmTurnRequest, signal: AbortSignal): AsyncIterable<CanonicalDelta> {
    signal.throwIfAborted();
    this.requests.push({ ...request, messages: [...request.messages], tools: [...request.tools] });
    const script = this.scripts[this.requests.length - 1];
    return streamScript(script ?? new Error('Unexpected LLM iteration'));
  }
}

class FakeMcpClient implements McpToolClientPort {
  public readonly calls: McpToolCall[] = [];
  public constructor(
    private readonly results: readonly (McpToolResult | Error)[],
    private readonly tools: readonly LlmToolDefinition[] = noTools,
  ) {}

  listTools(): Promise<readonly LlmToolDefinition[]> {
    return Promise.resolve(this.tools);
  }
  call(tool: McpToolCall): Promise<McpToolResult> {
    this.calls.push(tool);
    const result = this.results[this.calls.length - 1] ?? { content: 'ok', isError: false };
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  }
}

class RecordingSink implements TurnEventSink {
  public readonly events: InternalTurnEvent[] = [];
  publish(event: InternalTurnEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

class RecordingTransaction implements TurnTransactionPort {
  public readonly committed: string[] = [];
  public readonly rolledBack: string[] = [];
  commit(turnId: string): Promise<void> {
    this.committed.push(turnId);
    return Promise.resolve();
  }
  rollback(turnId: string): Promise<void> {
    this.rolledBack.push(turnId);
    return Promise.resolve();
  }
}

class RecordingArtifacts implements ArtifactSnapshotPort {
  public readonly paths: string[] = [];
  public constructor(private readonly events: string[]) {}

  snapshot(sessionId: string, path: string): Promise<ArtifactSnapshot> {
    this.events.push(`snapshot:${path}`);
    this.paths.push(`${sessionId}:${path}`);
    return Promise.resolve({
      id: 'cbb6aa43-5170-4fba-b1f6-1cd26c7f5069',
      path,
      name: 'report.md',
      mediaType: 'text/markdown; charset=utf-8',
      downloadUrl: '/api/files/cbb6aa43-5170-4fba-b1f6-1cd26c7f5069',
    });
  }

  download(): Promise<never> {
    return Promise.reject(new Error('Not used by AgentLoopService'));
  }
}

class FixedClock implements ClockPort {
  now(): number {
    return 0;
  }
}

interface AgentLoopFixture {
  readonly llm: ScriptedLlm;
  readonly mcp: FakeMcpClient;
  readonly sink: RecordingSink;
  readonly transaction: RecordingTransaction;
  readonly service: AgentLoopService;
}

function createService(
  scripts: readonly (readonly CanonicalDelta[] | Error)[],
  results: readonly (McpToolResult | Error)[] = [],
  maxIterations = limits.maxIterations,
): AgentLoopFixture {
  const llm = new ScriptedLlm(scripts);
  const mcp = new FakeMcpClient(results);
  const sink = new RecordingSink();
  const transaction = new RecordingTransaction();
  return {
    llm,
    mcp,
    sink,
    transaction,
    service: new AgentLoopService(llm, mcp, sink, transaction, new FixedClock(), {
      ...limits,
      maxIterations,
    }),
  };
}

function streamScript(script: readonly CanonicalDelta[] | Error): AsyncIterable<CanonicalDelta> {
  return (async function* (): AsyncIterable<CanonicalDelta> {
    await Promise.resolve();
    if (script instanceof Error) throw script;
    yield* script;
  })();
}

function toolTurn(
  id: string,
  name: string,
  server: 'search' | 'writer',
  json = '{}',
): CanonicalDelta[] {
  return [
    { type: 'content_block_start', index: 0, block: 'tool_use', id, name, server },
    { type: 'input_json_delta', index: 0, delta: json },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', stopReason: 'tool_use' },
  ];
}

function textTurn(text: string): CanonicalDelta[] {
  return [
    { type: 'content_block_start', index: 0, block: 'text' },
    { type: 'text_delta', index: 0, delta: text },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', stopReason: 'end_turn' },
  ];
}

describe('AgentLoopService', () => {
  it('ends on end_turn without executing a tool', async () => {
    const fixture = createService([textTurn('Done')]);

    await expect(fixture.service.run(input)).resolves.toMatchObject({
      blocks: [{ type: 'text', text: 'Done' }],
    });
    expect(fixture.mcp.calls).toEqual([]);
    expect(fixture.transaction.committed).toEqual(['turn-1']);
    expect(fixture.transaction.rolledBack).toEqual([]);
  });

  it('executes a tool, preserves its id, and supplies its result to the next iteration', async () => {
    const fixture = createService(
      [toolTurn('call-1', 'grep', 'search', '{"query":"TODO"}'), textTurn('Found it')],
      [{ content: 'match', isError: false }],
    );

    const exchange = await fixture.service.run(input);

    expect(fixture.mcp.calls).toEqual([
      { id: 'call-1', name: 'grep', server: 'search', input: { query: 'TODO' } },
    ]);
    expect(fixture.llm.requests).toHaveLength(2);
    expect(fixture.llm.requests[1]?.messages).toEqual([
      { role: 'user', content: 'Create the report' },
      {
        role: 'assistant',
        content: '',
        functionCall: { id: 'call-1', name: 'grep', arguments: '{"query":"TODO"}' },
      },
      { role: 'tool', callId: 'call-1', content: 'match' },
    ]);
    expect(exchange.blocks).toMatchObject([
      { type: 'tool_use', id: 'call-1' },
      { type: 'tool_result', toolUseId: 'call-1', content: 'match', isError: false },
      { type: 'text', text: 'Found it' },
    ]);
    expect(fixture.sink.events.filter((event) => event.type === 'tool')).toEqual([
      { type: 'tool', toolUseId: 'call-1', name: 'grep', server: 'search', status: 'running' },
      { type: 'tool', toolUseId: 'call-1', name: 'grep', server: 'search', status: 'done' },
    ]);
  });

  it('executes every tool use in one response and adds the turn id only to writer calls', async () => {
    const twoTools = [
      {
        type: 'content_block_start' as const,
        index: 0,
        block: 'tool_use' as const,
        id: 'search-1',
        name: 'grep',
        server: 'search' as const,
      },
      { type: 'input_json_delta' as const, index: 0, delta: '{"query":"a"}' },
      { type: 'content_block_stop' as const, index: 0 },
      {
        type: 'content_block_start' as const,
        index: 1,
        block: 'tool_use' as const,
        id: 'write-1',
        name: 'write_file',
        server: 'writer' as const,
      },
      { type: 'input_json_delta' as const, index: 1, delta: '{"path":"report.md"}' },
      { type: 'content_block_stop' as const, index: 1 },
      { type: 'message_delta' as const, stopReason: 'tool_use' as const },
    ];
    const fixture = createService(
      [twoTools, textTurn('Written')],
      [
        { content: 'search', isError: false },
        { content: 'written', isError: false },
      ],
    );

    await fixture.service.run(input);

    expect(fixture.mcp.calls).toEqual([
      { id: 'search-1', name: 'grep', server: 'search', input: { query: 'a' } },
      {
        id: 'write-1',
        name: 'write_file',
        server: 'writer',
        input: { path: 'report.md', turnId: 'turn-1' },
      },
    ]);
    expect(fixture.llm.requests[1]?.messages.slice(-2)).toEqual([
      { role: 'tool', callId: 'search-1', content: 'search' },
      { role: 'tool', callId: 'write-1', content: 'written' },
    ]);
  });

  it('snapshots and publishes a file only after a successful writer turn commit', async () => {
    const lifecycle: string[] = [];
    const fixture = createService(
      [
        toolTurn('write-1', 'write_file', 'writer', '{"path":"report.md","content":"Done"}'),
        textTurn('Written'),
      ],
      [{ content: 'written', isError: false }],
    );
    const artifacts = new RecordingArtifacts(lifecycle);
    fixture.transaction.commit = (turnId: string): Promise<void> => {
      lifecycle.push(`commit:${turnId}`);
      fixture.transaction.committed.push(turnId);
      return Promise.resolve();
    };
    const service = new AgentLoopService(
      fixture.llm,
      fixture.mcp,
      fixture.sink,
      fixture.transaction,
      new FixedClock(),
      limits,
      artifacts,
    );

    const exchange = await service.run(input);

    expect(lifecycle).toEqual(['commit:turn-1', 'snapshot:report.md']);
    expect(artifacts.paths).toEqual(['session-1:report.md']);
    expect(fixture.sink.events).toContainEqual({
      type: 'file',
      artifactId: 'cbb6aa43-5170-4fba-b1f6-1cd26c7f5069',
      path: 'report.md',
      downloadUrl: '/api/files/cbb6aa43-5170-4fba-b1f6-1cd26c7f5069',
    });
    expect(exchange.blocks).toContainEqual({
      type: 'file',
      id: 'cbb6aa43-5170-4fba-b1f6-1cd26c7f5069',
      path: 'report.md',
      name: 'report.md',
      mediaType: 'text/markdown; charset=utf-8',
      downloadUrl: '/api/files/cbb6aa43-5170-4fba-b1f6-1cd26c7f5069',
    });
  });

  it('returns an error tool result to the model without abandoning the turn', async () => {
    const fixture = createService(
      [toolTurn('missing-1', 'unknown_tool', 'search'), textTurn('Recovered')],
      [{ content: 'Tool unknown_tool failed: not found', isError: true }],
    );

    const exchange = await fixture.service.run(input);

    expect(exchange.blocks).toContainEqual({
      type: 'tool_result',
      toolUseId: 'missing-1',
      content: 'Tool unknown_tool failed: not found',
      isError: true,
    });
    expect(fixture.llm.requests[1]?.messages.at(-1)).toEqual({
      role: 'tool',
      callId: 'missing-1',
      content: 'Tool unknown_tool failed: not found',
    });
    expect(fixture.sink.events).toContainEqual({
      type: 'tool',
      toolUseId: 'missing-1',
      name: 'unknown_tool',
      server: 'search',
      status: 'error',
    });
  });

  it('rolls back and publishes an error when a writer tool rejects', async () => {
    const fixture = createService(
      [toolTurn('call-1', 'write_file', 'writer', '{"path":"report.md","content":"Done"}')],
      [new Error('MCP unavailable')],
    );

    await expect(fixture.service.run(input)).rejects.toBeInstanceOf(PublishedAgentTurnError);
    expect(fixture.transaction.rolledBack).toEqual(['turn-1']);
    expect(fixture.transaction.committed).toEqual([]);
    expect(fixture.sink.events.filter((event) => event.type === 'tool')).toHaveLength(2);
    expect(fixture.sink.events.at(-1)).toEqual({
      type: 'error',
      code: 'turn_failed',
      message: 'MCP unavailable',
    });
  });

  it('rolls back and publishes an error when the provider fails', async () => {
    const fixture = createService([new Error('provider unavailable')]);

    await expect(fixture.service.run(input)).rejects.toBeInstanceOf(PublishedAgentTurnError);
    expect(fixture.transaction.rolledBack).toEqual(['turn-1']);
    expect(fixture.sink.events).toEqual([
      { type: 'error', code: 'turn_failed', message: 'provider unavailable' },
    ]);
  });

  it('stops at the iteration limit and rolls back the unfinished turn', async () => {
    const fixture = createService(
      [toolTurn('call-1', 'grep', 'search'), toolTurn('call-2', 'grep', 'search')],
      [
        { content: 'one', isError: false },
        { content: 'two', isError: false },
      ],
      2,
    );

    await expect(fixture.service.run(input)).rejects.toThrow('Turn exceeded 2 iterations');
    expect(fixture.transaction.rolledBack).toEqual(['turn-1']);
    expect(fixture.transaction.committed).toEqual([]);
  });
});
