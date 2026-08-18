import { ChatService } from './chat.service';

describe('ChatService', () => {
  it('prefixes the message with the bot label', () => {
    const chatService = new ChatService();

    expect(chatService.createReply('Hello')).toEqual({ reply: 'Bot: Hello' });
  });
});
