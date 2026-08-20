import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { WorkspaceAccessError } from './safe-workspace.js';
import type { SafeWorkspace } from './safe-workspace.js';

const turnId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const path = z.string().min(1).max(1_024);
const text = z.string();
const sequence = z.number().int().nonnegative();

const tools = [
  definition('write_file', 'Atomically write a UTF-8 text file.', ['turnId', 'path', 'content']),
  definition('begin_write', 'Create a staged file for progressive writing.', ['turnId', 'path']),
  definition('append_write', 'Append an ordered UTF-8 chunk to a staged file.', [
    'turnId',
    'path',
    'sequence',
    'chunk',
  ]),
  definition('commit_write', 'Atomically publish a staged file.', ['turnId', 'path']),
  definition('abort_write', 'Discard a staged file.', ['turnId', 'path']),
  definition('commit_turn', 'Finalize all writer changes for a completed turn.', ['turnId']),
  definition('rollback_turn', 'Revert all writer changes for a failed turn.', ['turnId']),
] as const;

export interface WriterToolResult extends CallToolResult {
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
}

export class WriterToolService {
  public constructor(private readonly workspace: SafeWorkspace) {}

  public async execute(name: string, input: unknown): Promise<WriterToolResult> {
    try {
      return await this.executeValidated(name, input);
    } catch (error: unknown) {
      return { content: [{ type: 'text', text: this.errorMessage(error) }], isError: true };
    }
  }

  private async executeValidated(name: string, input: unknown): Promise<WriterToolResult> {
    if (name === 'write_file') return this.writeFile(input);
    if (name === 'begin_write') return this.beginWrite(input);
    if (name === 'append_write') return this.appendWrite(input);
    if (name === 'commit_write') return this.commitWrite(input);
    if (name === 'abort_write') return this.abortWrite(input);
    if (name === 'commit_turn') return this.finishTurn(input, true);
    if (name === 'rollback_turn') return this.finishTurn(input, false);
    return { content: [{ type: 'text', text: `Unknown writer tool "${name}".` }], isError: true };
  }

  private async writeFile(input: unknown): Promise<WriterToolResult> {
    const value = z.object({ turnId, path, content: text }).parse(input);
    return success(
      `Wrote ${await this.workspace.writeText(value.turnId, value.path, value.content)} bytes to ${value.path}.`,
    );
  }
  private async beginWrite(input: unknown): Promise<WriterToolResult> {
    const value = z.object({ turnId, path }).parse(input);
    await this.workspace.beginWrite(value.turnId, value.path);
    return success(`Started staged write for ${value.path}.`);
  }
  private async appendWrite(input: unknown): Promise<WriterToolResult> {
    const value = z.object({ turnId, path, sequence, chunk: text }).parse(input);
    return success(
      `Wrote ${await this.workspace.appendWrite(value.turnId, value.path, value.sequence, value.chunk)} staged bytes to ${value.path}.`,
    );
  }
  private async commitWrite(input: unknown): Promise<WriterToolResult> {
    const value = z.object({ turnId, path }).parse(input);
    return success(
      `Committed ${await this.workspace.commitWrite(value.turnId, value.path)} bytes to ${value.path}.`,
    );
  }
  private async abortWrite(input: unknown): Promise<WriterToolResult> {
    const value = z.object({ turnId, path }).parse(input);
    await this.workspace.abortWrite(value.turnId, value.path);
    return success(`Aborted staged write for ${value.path}.`);
  }
  private async finishTurn(input: unknown, commit: boolean): Promise<WriterToolResult> {
    const value = z.object({ turnId }).parse(input);
    if (commit) await this.workspace.commitTurn(value.turnId);
    else await this.workspace.rollbackTurn(value.turnId);
    return success(`${commit ? 'Committed' : 'Rolled back'} turn ${value.turnId}.`);
  }
  private errorMessage(error: unknown): string {
    return error instanceof WorkspaceAccessError || error instanceof z.ZodError
      ? error.message
      : 'Writer tool failed unexpectedly.';
  }
}

function definition(name: string, description: string, required: readonly string[]) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      required,
      properties: Object.fromEntries(
        required.map((key) => [key, { type: key === 'sequence' ? 'integer' : 'string' }]),
      ),
    },
  };
}
function success(value: string): WriterToolResult {
  return { content: [{ type: 'text', text: value }] };
}

export function createWriterServer(service: WriterToolService): Server {
  const server = new Server(
    { name: 'chat-app-writer', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    service.execute(request.params.name, request.params.arguments),
  );
  return server;
}

export { SafeWorkspace, WorkspaceAccessError } from './safe-workspace.js';
