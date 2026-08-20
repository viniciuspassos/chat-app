import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('re2', () => ({
  default: class FakeRe2 {
    public lastIndex = 0;
    private readonly expression: RegExp;

    public constructor(pattern: string, flags: string) {
      this.expression = new RegExp(pattern, flags);
    }

    public test(value: string): boolean {
      return this.expression.test(value);
    }
  },
}));

import { SafeWorkspace } from '@chat-app/mcp-writer/safe-workspace';
import { SearchToolService } from '../src/index.js';

const temporaryRoots: string[] = [];

async function createSearchService(): Promise<SearchToolService> {
  const root = await mkdtemp(join(tmpdir(), 'chat-app-search-'));
  temporaryRoots.push(root);
  await writeFile(join(root, 'example.ts'), 'export const answer = 42;\n');
  const workspace = new SafeWorkspace(root);
  await workspace.initialize();
  return new SearchToolService(workspace);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('SearchToolService', () => {
  it('returns line-addressable RE2 matches from the supplied workspace', async () => {
    const service = await createSearchService();

    await expect(service.grep('answer')).resolves.toEqual([
      { path: 'example.ts', line: 1, text: 'export const answer = 42;' },
    ]);
  });

  it('returns a safe tool error for unsupported tool names', async () => {
    const service = await createSearchService();

    await expect(service.execute('delete_file', {})).resolves.toMatchObject({ isError: true });
  });
});
