import {
  type Dispatch,
  type FormEvent,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ChatMessage } from '../models/chat-message';
import type { ChatApi } from '../services/chat-api';
import { useChatConversation } from '../state/use-chat-conversation';
import { normalizeChatInput, scrollTranscriptToBottom } from './chat-box-helpers';
import styles from './ChatBox.module.css';

export interface ChatBoxProps {
  chatApi: ChatApi;
}

function ChatHeader() {
  return (
    <header className={styles.header}>
      <span className={styles.statusDot} aria-hidden="true" />
      <div>
        <h1 id="chat-title">Chat Assistant</h1>
        <p>Online</p>
      </div>
    </header>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <li className={styles[`${message.role}Message`]} data-role={message.role}>
      <span className={styles.author}>{message.role === 'user' ? 'You' : 'Bot'}</span>
      <p>{message.body}</p>
    </li>
  );
}

function EmptyTranscript({ isEmpty }: { isEmpty: boolean }) {
  if (!isEmpty) return null;
  return <p className={styles.emptyState}>Send a message to start the conversation.</p>;
}

interface ConversationViewProps {
  isSending: boolean;
  messages: ChatMessage[];
}

function MessageList({ messages, isSending }: ConversationViewProps) {
  return (
    <ol className={styles.messageList}>
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {isSending && (
        <li className={styles.typing} role="status">
          Typing…
        </li>
      )}
    </ol>
  );
}

function ChatTranscript(properties: ConversationViewProps) {
  const transcriptReference = useRef<HTMLElement>(null);
  useEffect(() => {
    const transcript = transcriptReference.current;
    if (transcript) scrollTranscriptToBottom(transcript);
  }, [properties.messages, properties.isSending]);
  return (
    <section
      ref={transcriptReference}
      className={styles.transcript}
      aria-label="Conversation"
      aria-live="polite"
    >
      <EmptyTranscript isEmpty={properties.messages.length === 0} />
      <MessageList {...properties} />
    </section>
  );
}

interface MessageComposerProps {
  isSending: boolean;
  sendMessage: (message: string) => Promise<boolean>;
}

function useMessageComposer({ isSending, sendMessage }: MessageComposerProps) {
  const [input, setInput] = useState('');
  const inputReference = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!isSending) inputReference.current?.focus();
  }, [isSending]);

  async function submitMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const message = normalizeChatInput(input);
    if (!message || isSending) return;
    setInput('');
    const succeeded = await sendMessage(message);
    if (!succeeded) setInput(message);
  }

  return { input, inputReference, setInput, submitMessage };
}

interface ComposerInputProps {
  input: string;
  inputReference: RefObject<HTMLInputElement | null>;
  isSending: boolean;
  setInput: Dispatch<SetStateAction<string>>;
}

function ComposerInput({ input, inputReference, isSending, setInput }: ComposerInputProps) {
  return (
    <input
      ref={inputReference}
      id="chat-message"
      name="message"
      type="text"
      value={input}
      onChange={(event) => setInput(event.target.value)}
      placeholder="Type your message…"
      autoComplete="off"
      disabled={isSending}
    />
  );
}

function SendButton({ input, isSending }: { input: string; isSending: boolean }) {
  return (
    <button type="submit" disabled={!normalizeChatInput(input) || isSending}>
      Send
    </button>
  );
}

function MessageComposer(properties: MessageComposerProps) {
  const composer = useMessageComposer(properties);
  return (
    <form className={styles.composer} onSubmit={composer.submitMessage}>
      <label htmlFor="chat-message" className={styles.visuallyHidden}>
        Message
      </label>
      <ComposerInput {...composer} isSending={properties.isSending} />
      <SendButton input={composer.input} isSending={properties.isSending} />
    </form>
  );
}

function ChatError({ message }: { message: string | null }) {
  return (
    <p className={styles.error} role="alert" aria-live="assertive">
      {message}
    </p>
  );
}

export function ChatBox({ chatApi }: ChatBoxProps) {
  const conversation = useChatConversation(chatApi);
  return (
    <section className={styles.chatBox} aria-labelledby="chat-title">
      <ChatHeader />
      <ChatTranscript messages={conversation.messages} isSending={conversation.isSending} />
      <MessageComposer isSending={conversation.isSending} sendMessage={conversation.sendMessage} />
      <ChatError message={conversation.errorMessage} />
    </section>
  );
}
