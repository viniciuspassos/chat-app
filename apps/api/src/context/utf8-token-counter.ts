import { Buffer } from 'node:buffer';
import type { TokenCounterPort } from './context-selector.service';
export class Utf8TokenCounter implements TokenCounterPort {
  count(text: string): number {
    return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
  }
}
