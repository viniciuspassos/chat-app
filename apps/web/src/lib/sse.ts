export type ParsedSseEvent = { id?: string; event: string; data: string };

export class SseParser {
  private pending = '';
  private eventName = 'message';
  private eventId: string | undefined;
  private dataLines: string[] = [];
  public push(chunk: string): ParsedSseEvent[] {
    this.pending += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const events: ParsedSseEvent[] = [];
    let newlineIndex = this.pending.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.pending.slice(0, newlineIndex);
      this.pending = this.pending.slice(newlineIndex + 1);
      const parsed = this.consumeLine(line);
      if (parsed) events.push(parsed);
      newlineIndex = this.pending.indexOf('\n');
    }
    return events;
  }
  public finish(): ParsedSseEvent[] {
    const pendingLine = this.pending;
    this.pending = '';
    const pendingEvent = pendingLine ? this.consumeLine(pendingLine) : null;
    const finalEvent = this.consumeLine('');
    return [pendingEvent, finalEvent].filter((event): event is ParsedSseEvent => event !== null);
  }
  private consumeLine(line: string): ParsedSseEvent | null {
    if (line === '') {
      if (this.dataLines.length === 0) return null;
      const event = this.eventId
        ? { id: this.eventId, event: this.eventName, data: this.dataLines.join('\n') }
        : { event: this.eventName, data: this.dataLines.join('\n') };
      this.eventName = 'message';
      this.eventId = undefined;
      this.dataLines = [];
      return event;
    }
    if (line.startsWith(':')) return null;
    const separator = line.indexOf(':');
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, '') : '';
    if (field === 'event') this.eventName = value;
    if (field === 'id') this.eventId = value;
    if (field === 'data') this.dataLines.push(value);
    return null;
  }
}

export async function readSseStream(
  response: Response,
  onEvent: (event: ParsedSseEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error('SSE response body is missing');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let readResult = await reader.read();
  while (!readResult.done) {
    publishEvents(parser.push(decoder.decode(readResult.value, { stream: true })), onEvent);
    readResult = await reader.read();
  }
  publishEvents(parser.push(decoder.decode()), onEvent);
  publishEvents(parser.finish(), onEvent);
}
function publishEvents(events: ParsedSseEvent[], onEvent: (event: ParsedSseEvent) => void): void {
  for (const event of events) onEvent(event);
}
