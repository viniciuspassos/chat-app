import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SafeWorkspace } from '@chat-app/mcp-writer/safe-workspace';
import { createSearchServer, SearchToolService } from './index.js';

async function startSearchServer(): Promise<void> {
  const root = process.env.WORKSPACE_ROOT;
  if (!root) throw new Error('WORKSPACE_ROOT must point to an existing workspace.');
  const workspace = new SafeWorkspace(root);
  await workspace.initialize();
  await createSearchServer(new SearchToolService(workspace)).connect(new StdioServerTransport());
}
void startSearchServer().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Could not start search MCP server.'}\n`,
  );
  process.exitCode = 1;
});
