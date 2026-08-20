'use client';

import { ChatBox } from '@/components/chat-box';
import { ChatTranscript } from '@/components/chat-transcript';
import { useChatStream } from '@/hooks/use-chat-stream';

export default function HomePage(): React.JSX.Element {
  const { state, sendMessage, retryLastMessage } = useChatStream();
  return (
    <main className="shell">
      <header>
        <p className="eyebrow">CODEBASE COPILOT</p>
        <h1>Construa com contexto.</h1>
        <p>Descreva a mudança e acompanhe o trabalho no seu workspace.</p>
      </header>
      <ChatTranscript messages={state.messages} isStreaming={Boolean(state.activeTurnId)} />
      {state.error && (
        <div className="global-error" role="alert">
          <p>{state.error}</p>
          {state.retryMessage && (
            <button type="button" className="retry-button" onClick={() => void retryLastMessage()}>
              Tentar novamente
            </button>
          )}
        </div>
      )}
      <ChatBox
        disabled={!state.isReady || Boolean(state.activeTurnId)}
        onSend={sendMessage}
        retryMessage={state.retryMessage}
      />
    </main>
  );
}
