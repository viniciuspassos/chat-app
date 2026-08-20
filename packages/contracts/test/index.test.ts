import { describe, expect, it } from 'vitest';
import { canonicalDeltaSchema, internalTurnEventSchema, sseEventSchema } from '../src/index.js';

describe('contracts', () => {
  it('accepts canonical tool argument deltas', () => {
    const result = canonicalDeltaSchema.safeParse({
      type: 'input_json_delta',
      index: 2,
      delta: '{"path":',
    });

    expect(result.success).toBe(true);
  });

  it('rejects file events without a BFF download URL', () => {
    const result = sseEventSchema.safeParse({
      type: 'file',
      artifactId: 'cbb6aa43-5170-4fba-b1f6-1cd26c7f5069',
      path: 'auth.ts',
      downloadUrl: 'https://invalid.example',
    });

    expect(result.success).toBe(false);
  });

  it('keeps canonical deltas on the internal stream only', () => {
    expect(
      internalTurnEventSchema.safeParse({
        type: 'canonical_delta',
        delta: { type: 'content_block_stop', index: 1 },
      }).success,
    ).toBe(true);
    expect(sseEventSchema.safeParse({ type: 'canonical_delta' }).success).toBe(false);
  });
});
