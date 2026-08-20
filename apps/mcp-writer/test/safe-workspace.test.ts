import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
    await expect(workspace.readText('/tmp/secret.txt')).rejects.toBeInstanceOf(
      WorkspaceAccessError,
    );
    await expect(workspace.readText('nested/../secret.txt')).rejects.toBeInstanceOf(
      WorkspaceAccessError,
    );
    await expect(workspace.writeText('turn-2', '.env', 'secret')).rejects.toBeInstanceOf(
      WorkspaceAccessError,
    );
  });

  it('rejects forbidden directories for reads and writes', async () => {
    const { workspace } = await createWorkspace();

    await expect(workspace.readText('.git/config')).rejects.toBeInstanceOf(WorkspaceAccessError);
    await expect(
      workspace.writeText('turn-2', 'node_modules/pkg/index.js', 'x'),
    ).rejects.toBeInstanceOf(WorkspaceAccessError);
  });

  it('rejects symlink escapes for reads and writes', async () => {
    const { root, workspace } = await createWorkspace();
    const outside = await mkdtemp(join(tmpdir(), 'chat-app-outside-'));
    temporaryRoots.push(outside);
    await symlink(outside, join(root, 'linked'));
    await writeFile(join(outside, 'secret.txt'), 'secret');

    await expect(workspace.readText('linked/secret.txt')).rejects.toBeInstanceOf(
      WorkspaceAccessError,
    );
    await expect(
      workspace.writeText('turn-2', 'linked/secret.txt', 'secret'),
    ).rejects.toBeInstanceOf(WorkspaceAccessError);
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
