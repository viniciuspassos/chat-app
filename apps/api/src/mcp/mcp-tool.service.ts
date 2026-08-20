import type {
  LlmToolDefinition,
  McpToolCall,
  McpToolClientPort,
  McpToolResult,
} from '../domain/types';

const transactionToolNames = new Set(['commit_turn', 'rollback_turn']);
export interface McpTransportPort {
  listTools(): Promise<readonly LlmToolDefinition[]>;
  call(
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ readonly content: string; readonly isError?: boolean }>;
}
export class McpToolService implements McpToolClientPort {
  private readonly discoveredServers = new Map<string, 'search' | 'writer'>();

  public constructor(
    private readonly transports: Readonly<Record<'search' | 'writer', McpTransportPort>>,
  ) {}
  async listTools(): Promise<readonly LlmToolDefinition[]> {
    const [search, writer] = await Promise.all([
      this.transports.search.listTools(),
      this.transports.writer.listTools(),
    ]);
    const tools = [...search, ...writer].filter((tool) => !transactionToolNames.has(tool.name));
    this.assertUniqueNames(tools);
    this.rememberServers(search, 'search');
    this.rememberServers(writer, 'writer');
    return tools;
  }
  async call(tool: McpToolCall): Promise<McpToolResult> {
    const server = this.serverFor(tool.name);
    if (!server) return { content: `Unknown MCP tool: ${tool.name}`, isError: true };
    try {
      const response = await this.transports[server].call(tool.name, tool.input);
      return { content: response.content, isError: response.isError === true };
    } catch (error) {
      return {
        content: `Tool ${tool.name} failed: ${error instanceof Error ? error.message : 'unknown MCP failure'}`,
        isError: true,
      };
    }
  }
  private rememberServers(tools: readonly LlmToolDefinition[], server: 'search' | 'writer'): void {
    for (const tool of tools) this.discoveredServers.set(tool.name, server);
  }
  private serverFor(name: string): 'search' | 'writer' | undefined {
    if (transactionToolNames.has(name)) return 'writer';
    return this.discoveredServers.get(name);
  }
  private assertUniqueNames(tools: readonly LlmToolDefinition[]): void {
    const names = new Set<string>();
    for (const tool of tools) {
      if (names.has(tool.name)) throw new Error(`Duplicate MCP tool name: ${tool.name}`);
      names.add(tool.name);
    }
  }
}
