import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { LlmToolDefinition } from '../domain/types';
import type { McpTransportPort } from './mcp-tool.service';

export interface StdioMcpClientOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly name: string;
}
interface McpClientPort {
  connect(transport: StdioClientTransport): Promise<void>;
  listTools(): Promise<{ readonly tools: readonly McpToolDefinitionRaw[] }>;
  callTool(request: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }): Promise<McpToolResultRaw>;
  close(): Promise<void>;
}
interface McpToolDefinitionRaw {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
}
interface McpToolResultRaw {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly isError?: boolean;
}
interface ClosableTransport {
  close(): Promise<void>;
}
export class StdioMcpClient implements McpTransportPort {
  private constructor(
    private readonly client: McpClientPort,
    private readonly transport: ClosableTransport,
  ) {}
  static async start(
    options: StdioMcpClientOptions,
    createClient: () => McpClientPort = createProtocolClient,
  ): Promise<StdioMcpClient> {
    const transport = new StdioClientTransport({
      command: options.command,
      args: [...options.args],
      env: { ...options.environment },
    });
    const client = createClient();
    try {
      await client.connect(transport);
      return new StdioMcpClient(client, transport);
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }
  }
  static fromConnectedClient(client: McpClientPort, transport: ClosableTransport): StdioMcpClient {
    return new StdioMcpClient(client, transport);
  }
  async listTools(): Promise<readonly LlmToolDefinition[]> {
    return (await this.client.listTools()).tools.map(toLlmTool);
  }
  async call(
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ readonly content: string; readonly isError?: boolean }> {
    const result = await this.client.callTool({ name, arguments: input });
    return { content: result.content.map(contentText).join('\n'), isError: result.isError };
  }
  async close(): Promise<void> {
    await this.client.close();
    await this.transport.close();
  }
}
function createProtocolClient(): McpClientPort {
  return new Client({ name: 'chat-app-api', version: '1.0.0' }) as unknown as McpClientPort;
}
function toLlmTool(tool: McpToolDefinitionRaw): LlmToolDefinition {
  return {
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: asObject(tool.inputSchema),
  };
}
function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function contentText(content: { readonly type: string; readonly text?: string }): string {
  return content.type === 'text' && content.text !== undefined
    ? content.text
    : JSON.stringify(content);
}
