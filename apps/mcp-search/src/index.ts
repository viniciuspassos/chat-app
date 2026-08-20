import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import RE2 from 're2';
import { z } from 'zod';
import { MAX_LIST_FILES, WorkspaceAccessError } from '@chat-app/mcp-writer/safe-workspace';
import type { SafeWorkspace } from '@chat-app/mcp-writer/safe-workspace';

export const MAX_GREP_MATCHES = 200;
export const MAX_TOOL_RESULT_BYTES = 128 * 1024;
const path = z.string().min(1).max(1_024);
const pattern = z.string().min(1).max(4_096);
const tools = [
  {
    name: 'list_files',
    description: 'List text files in the sandboxed workspace.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file from the sandboxed workspace.',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
  },
  {
    name: 'grep',
    description: 'Find RE2 regular-expression matches in sandboxed text files.',
    inputSchema: {
      type: 'object',
      required: ['pattern'],
      properties: { pattern: { type: 'string' }, path: { type: 'string' } },
    },
  },
] as const;

export interface SearchToolResult extends CallToolResult {
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
}
export interface GrepMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export class SearchToolService {
  public constructor(private readonly workspace: SafeWorkspace) {}
  public async execute(name: string, input: unknown): Promise<SearchToolResult> {
    try {
      return await this.executeValidated(name, input);
    } catch (error: unknown) {
      return { content: [{ type: 'text', text: this.errorMessage(error) }], isError: true };
    }
  }
  public async grep(value: string, selectedPath?: string): Promise<GrepMatch[]> {
    const expression = this.expression(value);
    const files = selectedPath ? [selectedPath] : await this.workspace.listFiles(MAX_LIST_FILES);
    const matches: GrepMatch[] = [];
    for (const file of files) {
      if (matches.length >= MAX_GREP_MATCHES) break;
      this.collect(expression, file, await this.workspace.readText(file), matches);
    }
    return matches;
  }
  private async executeValidated(name: string, input: unknown): Promise<SearchToolResult> {
    if (name === 'list_files')
      return result(JSON.stringify(await this.workspace.listFiles(MAX_LIST_FILES)));
    if (name === 'read_file')
      return result(await this.workspace.readText(z.object({ path }).parse(input).path));
    if (name === 'grep') {
      const value = z.object({ pattern, path: path.optional() }).parse(input);
      return result(JSON.stringify(await this.grep(value.pattern, value.path)));
    }
    return { content: [{ type: 'text', text: `Unknown search tool "${name}".` }], isError: true };
  }
  private collect(expression: RE2, file: string, content: string, matches: GrepMatch[]): void {
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (matches.length >= MAX_GREP_MATCHES) return;
      if (expression.test(line)) matches.push({ path: file, line: index + 1, text: line });
      expression.lastIndex = 0;
    }
  }
  private expression(value: string): RE2 {
    try {
      return new RE2(value, 'u');
    } catch (error: unknown) {
      throw new WorkspaceAccessError(
        `Pattern "${value}" is not a valid RE2 expression: ${error instanceof Error ? error.message : 'invalid expression'}`,
      );
    }
  }
  private errorMessage(error: unknown): string {
    return error instanceof WorkspaceAccessError || error instanceof z.ZodError
      ? error.message
      : 'Search tool failed unexpectedly.';
  }
}

function result(value: string): SearchToolResult {
  const bytes = Buffer.from(value);
  const text =
    bytes.length <= MAX_TOOL_RESULT_BYTES
      ? value
      : `${bytes.subarray(0, MAX_TOOL_RESULT_BYTES - 15).toString('utf8')}\n[truncated]`;
  return { content: [{ type: 'text', text }] };
}
export function createSearchServer(service: SearchToolService): Server {
  const server = new Server(
    { name: 'chat-app-search', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    service.execute(request.params.name, request.params.arguments),
  );
  return server;
}
