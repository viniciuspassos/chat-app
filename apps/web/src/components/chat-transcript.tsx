import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '@/hooks/use-chat-stream';

type ChatTranscriptProps = { messages: ChatMessage[]; isStreaming: boolean };
function ToolChip({ name, server, status }: ChatMessage['tools'][number]): React.JSX.Element {
  return (
    <span className={`tool-chip tool-${status}`}>
      {server} · {name} · {status}
    </span>
  );
}
export function ChatTranscript({ messages, isStreaming }: ChatTranscriptProps): React.JSX.Element {
  const transcriptEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [messages, isStreaming]);
  return (
    <section className="transcript" aria-live="polite">
      {messages.map((message) => (
        <article className={`message message-${message.role}`} key={message.id}>
          {message.text && (
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
              {message.text}
            </ReactMarkdown>
          )}
          {message.tools.length > 0 && (
            <div className="tool-list">
              {message.tools.map((tool) => (
                <ToolChip key={tool.id} {...tool} />
              ))}
            </div>
          )}
          {message.files.length > 0 && (
            <div className="file-list">
              {message.files.map((file) => (
                <a className="file-chip" key={file.id} href={file.downloadUrl} download>
                  {file.path}
                </a>
              ))}
            </div>
          )}
          {message.error && (
            <p className="message-error" role="alert">
              {message.error}
            </p>
          )}
          {message.role === 'assistant' && isStreaming && message === messages.at(-1) && (
            <span className="cursor" aria-label="Responding" />
          )}
        </article>
      ))}
      <div ref={transcriptEnd} aria-hidden="true" />
    </section>
  );
}
