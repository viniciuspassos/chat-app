import { describe, expect, it } from 'vitest';
import { StdioMcpClient } from '../src/mcp/stdio-mcp.client';

describe('StdioMcpClient', () => {
  it('converts dynamically discovered MCP schemas and forwards tool arguments', async () => {
    const protocol = new FakeProtocolClient();
    const client = StdioMcpClient.fromConnectedClient(protocol, new FakeTransport());
    const input = { directory: 'src', depth: 2 };

    await expect(client.listTools()).resolves.toEqual([
      {
        name: 'arbitrary_discovered_tool',
        description: 'Provided by the MCP server.',
        inputSchema: {
          type: 'object',
          properties: { directory: { type: 'string' }, depth: { type: 'number' } },
        },
      },
    ]);
    await expect(client.call('arbitrary_discovered_tool', input)).resolves.toEqual({
      content: 'complete',
      isError: false,
    });

    expect(protocol.requests).toEqual([{ name: 'arbitrary_discovered_tool', arguments: input }]);
  });

  it('preserves MCP execution errors for the agent loop', async () => {
    const protocol = new FakeProtocolClient(true);
    const client = StdioMcpClient.fromConnectedClient(protocol, new FakeTransport());

    await expect(client.call('arbitrary_discovered_tool', {})).resolves.toEqual({
      content: 'permission denied',
      isError: true,
    });
  });
});

class FakeProtocolClient {
  public readonly requests: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }[] = [];

  public constructor(private readonly returnsError = false) {}

  connect(transport: unknown): Promise<void> {
    void transport;
    return Promise.resolve();
  }

  listTools(): Promise<{
    readonly tools: readonly {
      readonly name: string;
      readonly description?: string;
      readonly inputSchema: unknown;
    }[];
  }> {
    return Promise.resolve({
      tools: [
        {
          name: 'arbitrary_discovered_tool',
          description: 'Provided by the MCP server.',
          inputSchema: {
            type: 'object',
            properties: { directory: { type: 'string' }, depth: { type: 'number' } },
          },
        },
      ],
    });
  }

  callTool(request: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }): Promise<{
    readonly content: readonly { readonly type: string; readonly text?: string }[];
    readonly isError?: boolean;
  }> {
    this.requests.push(request);
    return Promise.resolve({
      content: [{ type: 'text', text: this.returnsError ? 'permission denied' : 'complete' }],
      isError: this.returnsError,
    });
  }

  async close(): Promise<void> {}
}

class FakeTransport {
  async close(): Promise<void> {}
}
