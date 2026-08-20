import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createWriterServer, SafeWorkspace, WriterToolService } from './index.js';

async function startWriterServer(): Promise<void> {
  const root = process.env.WORKSPACE_ROOT;
  if (!root) throw new Error('WORKSPACE_ROOT must point to an existing workspace.');
  const workspace = new SafeWorkspace(root);
  await workspace.initialize();
  await createWriterServer(new WriterToolService(workspace)).connect(new StdioServerTransport());
}

void startWriterServer().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Could not start writer MCP server.'}\n`,
  );
  process.exitCode = 1;
});
