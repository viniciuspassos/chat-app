'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

type ChatBoxProps = {
  disabled: boolean;
  onSend: (message: string) => Promise<void>;
  retryMessage?: string;
};

export function ChatBox({ disabled, onSend, retryMessage }: ChatBoxProps): React.JSX.Element {
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);
  useEffect(() => {
    if (retryMessage) setMessage(retryMessage);
  }, [retryMessage]);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const outgoingMessage = message.trim();
    if (!outgoingMessage || disabled) return;
    setMessage('');
    await onSend(outgoingMessage);
  }
  return (
    <form className="chat-box" onSubmit={submit}>
      <label className="sr-only" htmlFor="message">
        Mensagem
      </label>
      <textarea
        id="message"
        ref={inputRef}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Peça uma alteração no código…"
        rows={3}
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !message.trim()}>
        Enviar
      </button>
    </form>
  );
}
