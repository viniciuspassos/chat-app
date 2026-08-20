import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SafeWorkspace, WorkspaceAccessError } from '../src/safe-workspace.js';

const temporaryRoots: string[] = [];

async function createWorkspace(): Promise<{ root: string; workspace: SafeWorkspace }> {
  const root = await mkdtemp(join(tmpdir(), 'chat-app-copilot-'));
  temporaryRoots.push(root);
  const workspace = new SafeWorkspace(root);
  await workspace.initialize();
  return { root, workspace };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('SafeWorkspace', () => {
  it('writes files and restores the prior content when a turn is rolled back', async () => {
    const { root, workspace } = await createWorkspace();
    await writeFile(join(root, 'note.txt'), 'before');

    await expect(workspace.writeText('turn-1', 'note.txt', 'after')).resolves.toBe(5);
    await workspace.rollbackTurn('turn-1');

    await expect(readFile(join(root, 'note.txt'), 'utf8')).resolves.toBe('before');
  });

  it('rejects paths outside the supplied workspace', async () => {
    const { workspace } = await createWorkspace();

    await expect(workspace.readText('../secret.txt')).rejects.toBeInstanceOf(WorkspaceAccessError);
    await expect(workspace.writeText('turn-2', '.env', 'secret')).rejects.toBeInstanceOf(
      WorkspaceAccessError,
    );
  });

  it('publishes an ordered staged write only after commit', async () => {
    const { root, workspace } = await createWorkspace();
    await workspace.beginWrite('turn-3', 'generated.txt');
    await workspace.appendWrite('turn-3', 'generated.txt', 0, 'hello ');
    await workspace.appendWrite('turn-3', 'generated.txt', 1, 'world');
    await workspace.commitWrite('turn-3', 'generated.txt');

    await expect(readFile(join(root, 'generated.txt'), 'utf8')).resolves.toBe('hello world');
  });
});
