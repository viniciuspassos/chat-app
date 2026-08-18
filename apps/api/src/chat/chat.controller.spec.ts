import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  it('delegates creation of the reply to ChatService', () => {
    const chatController = new ChatController(new ChatService());

    expect(chatController.sendMessage({ message: 'Hello' })).toEqual({
      reply: 'Bot: Hello',
    });
  });
});
