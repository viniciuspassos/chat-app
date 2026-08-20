import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mcpEntrypoint } from '../src/runtime/production-runtime.factory';

describe('mcpEntrypoint', () => {
  it('uses an absolute path outside the API working directory', () => {
    expect(mcpEntrypoint('search')).toMatch(/\/apps\/mcp-search\/src\/main\.ts$/);
    expect(mcpEntrypoint('writer')).toMatch(/\/apps\/mcp-writer\/src\/main\.ts$/);
    expect(isAbsolute(mcpEntrypoint('search'))).toBe(true);
  });
});
