import type { ChatResponse } from '@chat-app/contracts';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ChatBox } from '../src/components/ChatBox';
import type { ChatApi } from '../src/services/chat-api';

interface PendingChatCall {
  reject: (reason?: unknown) => void;
  resolve: (response: ChatResponse) => void;
}

class FakeChatApi implements ChatApi {
  public readonly requests: string[] = [];
  private readonly pendingCalls: PendingChatCall[] = [];

  public async sendMessage(message: string): Promise<ChatResponse> {
    this.requests.push(message);
    return new Promise<ChatResponse>((resolve, reject) => {
      this.pendingCalls.push({ reject, resolve });
    });
  }

  public resolveNext(reply: string): void {
    const pendingCall = this.takeNextCall();
    pendingCall.resolve({ reply });
  }

  public rejectNext(error: Error): void {
    const pendingCall = this.takeNextCall();
    pendingCall.reject(error);
  }

  private takeNextCall(): PendingChatCall {
    const pendingCall = this.pendingCalls.shift();
    if (!pendingCall)
      throw new Error('No pending fake chat call; expected sendMessage to be called first.');
    return pendingCall;
  }
}

describe('ChatBox', () => {
  it('keeps empty submissions disabled and exposes an accessible composer', async () => {
    const user = userEvent.setup();
    render(<ChatBox chatApi={new FakeChatApi()} />);
    const input = screen.getByRole('textbox', { name: 'Message' });
    const sendButton = screen.getByRole('button', { name: 'Send' });

    expect(input).toHaveFocus();
    expect(sendButton).toBeDisabled();
    await user.type(input, '   ');
    expect(sendButton).toBeDisabled();
  });

  it('submits with Enter, renders optimistically, and blocks concurrent sends', async () => {
    const chatApi = new FakeChatApi();
    const user = userEvent.setup();
    render(<ChatBox chatApi={chatApi} />);
    const input = screen.getByRole('textbox', { name: 'Message' });

    await user.type(input, '  Hello there  {Enter}');

    expect(chatApi.requests).toEqual(['Hello there']);
    const userMessage = screen.getByText('Hello there').closest('li');
    expect(userMessage).toHaveAttribute('data-role', 'user');
    expect(userMessage?.className).toContain('userMessage');
    expect(screen.getByRole('status')).toHaveTextContent('Typing…');
    expect(input).toBeDisabled();
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('adds the bot reply on the left, scrolls, and restores focus after success', async () => {
    const chatApi = new FakeChatApi();
    const user = userEvent.setup();
    render(<ChatBox chatApi={chatApi} />);
    const transcript = screen.getByRole('region', { name: 'Conversation' });
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 520 });
    const input = screen.getByRole('textbox', { name: 'Message' });

    await user.type(input, 'Hello{Enter}');
    await act(async () => chatApi.resolveNext('Bot: Hello'));

    const botMessage = screen.getByText('Bot: Hello').closest('li');
    const messageRoles = screen.getAllByRole('listitem').map((message) => message.dataset.role);
    expect(botMessage).toHaveAttribute('data-role', 'bot');
    expect(botMessage?.className).toContain('botMessage');
    expect(messageRoles).toEqual(['user', 'bot']);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(transcript.scrollTop).toBe(520);
    expect(input).toHaveFocus();
  });

  it('retains history and restores normalized input after a failure', async () => {
    const chatApi = new FakeChatApi();
    const user = userEvent.setup();
    render(<ChatBox chatApi={chatApi} />);
    const input = screen.getByRole('textbox', { name: 'Message' });

    await user.type(input, '  Please retry  {Enter}');
    await act(async () => chatApi.rejectNext(new Error('Connection lost, please retry.')));

    expect(screen.getByText('Please retry').closest('li')).toHaveAttribute('data-role', 'user');
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost, please retry.');
    expect(input).toHaveValue('Please retry');
    expect(input).toHaveFocus();
    expect(input).toBeEnabled();
  });
});
