import type { CanonicalDelta, ContentBlock } from '@chat-app/contracts';
import type { JsonValue } from './types';

interface PendingTextBlock {
  readonly kind: 'text';
  text: string;
}
interface PendingToolBlock {
  readonly kind: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly server: 'search' | 'writer';
  inputJson: string;
}
type PendingBlock = PendingTextBlock | PendingToolBlock;

export class BlockAssembler {
  private readonly pending = new Map<number, PendingBlock>();
  private readonly completed = new Map<number, ContentBlock>();

  accept(delta: CanonicalDelta): ContentBlock | undefined {
    if (delta.type === 'content_block_start') return this.start(delta);
    if (delta.type === 'text_delta') return this.appendText(delta.index, delta.delta);
    if (delta.type === 'input_json_delta') return this.appendInput(delta.index, delta.delta);
    if (delta.type === 'content_block_stop') return this.stop(delta.index);
    return undefined;
  }

  blocks(): readonly ContentBlock[] {
    return [...this.completed.entries()]
      .sort(([firstIndex], [secondIndex]) => firstIndex - secondIndex)
      .map(([, block]) => block);
  }

  private start(delta: Extract<CanonicalDelta, { type: 'content_block_start' }>): undefined {
    this.pending.set(
      delta.index,
      delta.block === 'text' ? { kind: 'text', text: '' } : this.toolBlock(delta),
    );
    return undefined;
  }

  private toolBlock(
    delta: Extract<CanonicalDelta, { type: 'content_block_start' }>,
  ): PendingToolBlock {
    if (!delta.id || !delta.name || !delta.server)
      throw new Error('Tool block start requires id, name, and server');
    return {
      kind: 'tool_use',
      id: delta.id,
      name: delta.name,
      server: delta.server,
      inputJson: '',
    };
  }

  private appendText(index: number, delta: string): undefined {
    const block = this.pending.get(index);
    if (!block || block.kind !== 'text')
      throw new Error(`Text delta has no text block at index ${index}`);
    block.text += delta;
    return undefined;
  }

  private appendInput(index: number, delta: string): undefined {
    const block = this.pending.get(index);
    if (!block || block.kind !== 'tool_use')
      throw new Error(`JSON delta has no tool block at index ${index}`);
    block.inputJson += delta;
    return undefined;
  }

  private stop(index: number): ContentBlock {
    const pending = this.pending.get(index);
    if (!pending) throw new Error(`Block stop has no block at index ${index}`);
    this.pending.delete(index);
    const block =
      pending.kind === 'text'
        ? { type: 'text' as const, text: pending.text }
        : this.toToolUse(pending);
    this.completed.set(index, block);
    return block;
  }

  private toToolUse(block: PendingToolBlock): ContentBlock {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      server: block.server,
      input: this.parseInput(block.inputJson, block.id),
    };
  }

  private parseInput(inputJson: string, id: string): Record<string, JsonValue> {
    try {
      const value: unknown = JSON.parse(inputJson || '{}');
      if (!isJsonObject(value)) throw new Error('expected an object');
      return value;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      throw new Error(`Tool ${id} has invalid JSON input: ${detail}`);
    }
  }
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
