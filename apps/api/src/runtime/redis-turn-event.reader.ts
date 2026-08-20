import type { StreamEntry, TurnEventReaderPort } from './runtime-copilot.api';
interface RedisStreamRecord {
  readonly id: string;
  readonly message: Record<string, string>;
}
export interface RedisRangePort {
  xRange(key: string, start: string, end: string): Promise<readonly RedisStreamRecord[]>;
}
export class RedisTurnEventReader implements TurnEventReaderPort {
  public constructor(private readonly redis: RedisRangePort) {}
  async read(turnId: string, afterId?: string): Promise<readonly StreamEntry[]> {
    const records = await this.redis.xRange(
      `turn:${turnId}:events`,
      afterId === undefined ? '-' : nextStreamId(afterId),
      '+',
    );
    return records.map(parseRecord);
  }
}
function nextStreamId(id: string): string {
  const [milliseconds, sequence] = id.split('-');
  if (!milliseconds || sequence === undefined) throw new Error(`Invalid Redis stream id ${id}`);
  return `${milliseconds}-${Number(sequence) + 1}`;
}
function parseRecord(record: RedisStreamRecord): StreamEntry {
  const serialized = record.message.payload;
  if (!serialized) throw new Error(`Redis stream record ${record.id} has no payload`);
  return {
    id: record.id,
    type: record.message.event ?? 'message',
    payload: JSON.parse(serialized) as unknown,
  };
}
