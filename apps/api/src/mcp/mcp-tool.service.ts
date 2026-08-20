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
    return tools;
  }
  async call(tool: McpToolCall): Promise<McpToolResult> {
    try {
      const response = await this.transports[tool.server].call(tool.name, tool.input);
      return { content: response.content, isError: response.isError === true };
    } catch (error) {
      return {
        content: `Tool ${tool.name} failed: ${error instanceof Error ? error.message : 'unknown MCP failure'}`,
        isError: true,
      };
    }
  }
  private assertUniqueNames(tools: readonly LlmToolDefinition[]): void {
    const names = new Set<string>();
    for (const tool of tools) {
      if (names.has(tool.name)) throw new Error(`Duplicate MCP tool name: ${tool.name}`);
      names.add(tool.name);
    }
  }
}
