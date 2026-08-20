import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatBox } from '@/components/chat-box';
import { ChatTranscript } from '@/components/chat-transcript';

describe('chat components', () => {
  it('sends trimmed composer input and clears the field', () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<ChatBox disabled={false} onSend={onSend} />);
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: '  criar teste  ' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Enviar' }).closest('form')!);
    expect(onSend).toHaveBeenCalledWith('criar teste');
    expect(screen.getByLabelText('Mensagem')).toHaveValue('');
  });

  it('renders GFM downloads and not raw HTML', () => {
    render(
      <ChatTranscript
        isStreaming={true}
        messages={[
          {
            id: 'a',
            role: 'assistant',
            text: '**ok** <script>alert(1)</script>',
            tools: [],
            files: [{ id: 'f', path: 'report.md', downloadUrl: '/api/files/f' }],
          },
        ]}
      />,
    );
    expect(screen.getByText('ok').tagName).toBe('STRONG');
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByRole('link', { name: 'report.md' })).toHaveAttribute('href', '/api/files/f');
  });
});
