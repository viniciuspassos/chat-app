import { describe, expect, it } from 'vitest';
import type { LlmToolDefinition } from '../src/domain/types';
import { McpToolService, type McpTransportPort } from '../src/mcp/mcp-tool.service';

const searchTool: LlmToolDefinition = {
  name: 'search_workspace',
  description: 'Searches the workspace.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
};
const writerTool: LlmToolDefinition = {
  name: 'create_report',
  description: 'Creates a report.',
  inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
};

describe('McpToolService', () => {
  it('discovers arbitrary tools and retains their MCP schemas', async () => {
    const search = new FakeMcpTransport([searchTool]);
    const writer = new FakeMcpTransport([writerTool]);
    const service = new McpToolService({ search, writer });

    await expect(service.listTools()).resolves.toEqual([searchTool, writerTool]);
  });

  it('routes a discovered tool to its originating server and forwards arguments', async () => {
    const search = new FakeMcpTransport([searchTool], { content: 'found' });
    const writer = new FakeMcpTransport([writerTool]);
    const service = new McpToolService({ search, writer });
    const input = { query: 'quarterly report' };

    await service.listTools();
    await expect(
      service.call({ id: 'call_1', name: searchTool.name, input, server: 'writer' }),
    ).resolves.toEqual({ content: 'found', isError: false });

    expect(search.calls).toEqual([{ name: searchTool.name, input }]);
    expect(writer.calls).toEqual([]);
  });

  it('rejects unknown tools without calling either MCP server', async () => {
    const search = new FakeMcpTransport([searchTool]);
    const writer = new FakeMcpTransport([writerTool]);
    const service = new McpToolService({ search, writer });

    await service.listTools();
    await expect(
      service.call({ id: 'call_1', name: 'not_discovered', input: {}, server: 'search' }),
    ).resolves.toEqual({ content: 'Unknown MCP tool: not_discovered', isError: true });

    expect(search.calls).toEqual([]);
    expect(writer.calls).toEqual([]);
  });

  it('surfaces discovery failures and converts tool execution failures to error results', async () => {
    const unavailable = new FakeMcpTransport([], undefined, new Error('connection refused'));
    const writer = new FakeMcpTransport([writerTool], undefined, new Error('execution failed'));
    const service = new McpToolService({ search: unavailable, writer });

    await expect(service.listTools()).rejects.toThrow('connection refused');

    const availableService = new McpToolService({
      search: new FakeMcpTransport([]),
      writer,
    });
    await availableService.listTools();
    await expect(
      availableService.call({ id: 'call_1', name: writerTool.name, input: {}, server: 'writer' }),
    ).resolves.toEqual({ content: 'Tool create_report failed: execution failed', isError: true });
  });
});

class FakeMcpTransport implements McpTransportPort {
  public readonly calls: { readonly name: string; readonly input: Record<string, unknown> }[] = [];

  public constructor(
    private readonly tools: readonly LlmToolDefinition[],
    private readonly response: { readonly content: string; readonly isError?: boolean } = {
      content: 'ok',
    },
    private readonly failure?: Error,
  ) {}

  listTools(): Promise<readonly LlmToolDefinition[]> {
    if (this.failure?.message === 'connection refused') return Promise.reject(this.failure);
    return Promise.resolve(this.tools);
  }

  call(
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ readonly content: string; readonly isError?: boolean }> {
    this.calls.push({ name, input });
    if (this.failure?.message === 'execution failed') return Promise.reject(this.failure);
    return Promise.resolve(this.response);
  }
}
