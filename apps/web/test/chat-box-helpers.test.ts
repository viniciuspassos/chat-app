import { describe, expect, it } from 'vitest';
import {
  getSafeChatError,
  normalizeChatInput,
  scrollTranscriptToBottom,
} from '../src/components/chat-box-helpers';

describe('chat box helpers', () => {
  it('normalizes only the outside whitespace of input', () => {
    expect(normalizeChatInput('  hello   there  ')).toBe('hello   there');
  });

  it('returns safe error messages without exposing unknown values', () => {
    expect(getSafeChatError(new Error('Known failure'))).toBe('Known failure');
    expect(getSafeChatError({ secret: 'not exposed' })).toBe('Service unavailable, please retry.');
  });

  it('scrolls a transcript to its total content height', () => {
    const transcript = document.createElement('section');
    Object.defineProperty(transcript, 'scrollHeight', { value: 480 });
    scrollTranscriptToBottom(transcript);
    expect(transcript.scrollTop).toBe(480);
  });
});
