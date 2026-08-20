import { describe, expect, it } from 'vitest';

import { BlockAssembler } from '../src/domain/block-assembler';

describe('BlockAssembler', () => {
  it('reconstructs text from successive deltas', () => {
    const assembler = new BlockAssembler();

    assembler.accept({ type: 'content_block_start', index: 0, block: 'text' });
    assembler.accept({ type: 'text_delta', index: 0, delta: 'Hello, ' });
    assembler.accept({ type: 'text_delta', index: 0, delta: 'world.' });

    expect(assembler.accept({ type: 'content_block_stop', index: 0 })).toEqual({
      type: 'text',
      text: 'Hello, world.',
    });
    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'Hello, world.' }]);
  });

  it('reconstructs multiple blocks independently', () => {
    const assembler = new BlockAssembler();

    assembler.accept({ type: 'content_block_start', index: 0, block: 'text' });
    assembler.accept({ type: 'text_delta', index: 0, delta: 'First' });
    assembler.accept({ type: 'content_block_stop', index: 0 });
    assembler.accept({ type: 'content_block_start', index: 1, block: 'text' });
    assembler.accept({ type: 'text_delta', index: 1, delta: 'Second' });
    assembler.accept({ type: 'content_block_stop', index: 1 });

    expect(assembler.blocks()).toEqual([
      { type: 'text', text: 'First' },
      { type: 'text', text: 'Second' },
    ]);
  });

  it('reconstructs interleaved text and partial tool JSON by block index', () => {
    const assembler = new BlockAssembler();

    assembler.accept({ type: 'content_block_start', index: 0, block: 'text' });
    assembler.accept({
      type: 'content_block_start',
      index: 1,
      block: 'tool_use',
      id: 'call_1',
      name: 'read_file',
      server: 'search',
    });
    assembler.accept({ type: 'text_delta', index: 0, delta: 'Reading ' });
    assembler.accept({ type: 'input_json_delta', index: 1, delta: '{"path":"src/' });
    assembler.accept({ type: 'text_delta', index: 0, delta: 'a file.' });
    assembler.accept({ type: 'input_json_delta', index: 1, delta: 'index.ts"}' });
    assembler.accept({ type: 'content_block_stop', index: 1 });
    assembler.accept({ type: 'content_block_stop', index: 0 });

    expect(assembler.blocks()).toEqual([
      { type: 'text', text: 'Reading a file.' },
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'read_file',
        server: 'search',
        input: { path: 'src/index.ts' },
      },
    ]);
  });

  it('does not parse tool JSON until the tool block is complete', () => {
    const assembler = new BlockAssembler();

    assembler.accept({
      type: 'content_block_start',
      index: 0,
      block: 'tool_use',
      id: 'call_1',
      name: 'grep',
      server: 'search',
    });
    assembler.accept({ type: 'input_json_delta', index: 0, delta: '{"query":"todo"' });

    expect(assembler.blocks()).toEqual([]);

    assembler.accept({ type: 'input_json_delta', index: 0, delta: '}' });
    expect(assembler.accept({ type: 'content_block_stop', index: 0 })).toEqual({
      type: 'tool_use',
      id: 'call_1',
      name: 'grep',
      server: 'search',
      input: { query: 'todo' },
    });
  });

  it.each(['{"path":"src/', '{bad json}'])(
    'rejects malformed or incomplete tool JSON when block completion requires parsing: %s',
    (inputJson) => {
      const assembler = new BlockAssembler();

      assembler.accept({
        type: 'content_block_start',
        index: 0,
        block: 'tool_use',
        id: 'call_invalid',
        name: 'read_file',
        server: 'search',
      });
      assembler.accept({ type: 'input_json_delta', index: 0, delta: inputJson });

      expect(() => assembler.accept({ type: 'content_block_stop', index: 0 })).toThrow(
        'Tool call_invalid has invalid JSON input',
      );
      expect(assembler.blocks()).toEqual([]);
    },
  );
});
