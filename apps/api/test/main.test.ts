import { describe, expect, it } from 'vitest';
import { readProductionOptions } from '../src/main.js';

describe('readProductionOptions', () => {
  it('keeps session-backed active turns alive through the configured turn timeout', () => {
    const options = readProductionOptions({
      LLM_API_KEY: 'test-key',
      SESSION_IDLE_TTL_MS: '1000',
      TURN_TIMEOUT_MS: '300000',
    });

    expect(options.sessionTtlSeconds).toBe(300);
    expect(options.agentLimits.turnTimeoutMs).toBe(300_000);
  });

  it('preserves a longer configured idle session lifetime', () => {
    const options = readProductionOptions({
      LLM_API_KEY: 'test-key',
      SESSION_IDLE_TTL_MS: '600000',
      TURN_TIMEOUT_MS: '300000',
    });

    expect(options.sessionTtlSeconds).toBe(600);
  });
});
