export type BrowserTool = {
  id: string;
  name: string;
  server: 'search' | 'writer';
  status: 'done' | 'error';
};
export type BrowserFile = { id: string; path: string; downloadUrl: string };
export type BrowserExchange = {
  id: string;
  userMessage: string;
  assistant: { text: string; tools: BrowserTool[]; files: BrowserFile[] };
};
export type BrowserHistory = { exchanges: BrowserExchange[] };
type JsonRecord = Record<string, unknown>;
function recordValue(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}
function browserServer(value: unknown): 'search' | 'writer' | null {
  return value === 'search' || value === 'writer' ? value : null;
}
function browserFile(value: JsonRecord): BrowserFile | null {
  const { id, path, downloadUrl } = value;
  return typeof id === 'string' &&
    typeof path === 'string' &&
    typeof downloadUrl === 'string' &&
    downloadUrl.startsWith('/api/files/')
    ? { id, path, downloadUrl }
    : null;
}
function browserTool(value: JsonRecord): BrowserTool | null {
  const { id, name } = value;
  const server = browserServer(value.server);
  return typeof id === 'string' && typeof name === 'string' && server
    ? { id, name, server, status: 'done' }
    : null;
}
function browserExchange(value: unknown): BrowserExchange | null {
  const exchange = recordValue(value);
  if (
    !exchange ||
    typeof exchange.id !== 'string' ||
    typeof exchange.userMessage !== 'string' ||
    !Array.isArray(exchange.blocks)
  )
    return null;
  const tools: BrowserTool[] = [];
  const files: BrowserFile[] = [];
  let text = '';
  for (const rawBlock of exchange.blocks) {
    const block = recordValue(rawBlock);
    if (!block) continue;
    if (block.type === 'text' && typeof block.text === 'string') text += block.text;
    if (block.type === 'tool_use') {
      const tool = browserTool(block);
      if (tool) tools.push(tool);
    }
    if (
      block.type === 'tool_result' &&
      block.isError === true &&
      typeof block.toolUseId === 'string'
    ) {
      const toolIndex = tools.findIndex((tool) => tool.id === block.toolUseId);
      const tool = tools[toolIndex];
      if (tool) tools[toolIndex] = { ...tool, status: 'error' };
    }
    if (block.type === 'file') {
      const file = browserFile(block);
      if (file) files.push(file);
    }
  }
  return { id: exchange.id, userMessage: exchange.userMessage, assistant: { text, tools, files } };
}
export function sanitizeBackendHistory(value: unknown): BrowserHistory {
  const payload = recordValue(value);
  const exchanges = Array.isArray(value) ? value : payload?.exchanges;
  return !Array.isArray(exchanges)
    ? { exchanges: [] }
    : {
        exchanges: exchanges
          .map(browserExchange)
          .filter((exchange): exchange is BrowserExchange => !!exchange),
      };
}
