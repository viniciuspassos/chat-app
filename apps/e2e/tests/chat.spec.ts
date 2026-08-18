import { expect, type Locator, type Page, type Response, type Route, test } from '@playwright/test';

async function openChatPage(page: Page): Promise<Locator> {
  await page.goto('/');
  const messageInput = page.getByLabel('Message');
  await expect(messageInput).toBeFocused();
  return messageInput;
}

async function submitMessage(page: Page, messageInput: Locator, message: string): Promise<void> {
  await messageInput.fill(message);
  await page.getByRole('button', { name: 'Send' }).click();
}

function isPostChatResponse(response: Response): boolean {
  const isChatRoute = response.url().endsWith('/chat');
  const isPostRequest = response.request().method() === 'POST';
  return isChatRoute && isPostRequest;
}

function isThrottledChatResponse(response: Response): boolean {
  const isChatResponse = isPostChatResponse(response);
  const isRateLimited = response.status() === 429;
  return isChatResponse && isRateLimited;
}

async function expectRenderedMessage(
  page: Page,
  role: 'bot' | 'user',
  text: string,
): Promise<void> {
  const message = page.locator(`[data-role="${role}"]`);
  await expect(message).toContainText(text);
}

async function installTypingStateCheck(page: Page, messageInput: Locator): Promise<void> {
  await page.route('**/chat', async (route): Promise<void> => {
    await expect(page.getByRole('status')).toHaveText('Typing…');
    await expect(messageInput).toBeDisabled();
    await route.continue();
  });
}

async function abortChatRequest(route: Route): Promise<void> {
  const failureCode = 'connectionrefused';
  await route.abort(failureCode);
}

async function sendSuccessfulMessages(page: Page, messageInput: Locator): Promise<void> {
  for (let requestNumber = 1; requestNumber <= 5; requestNumber += 1) {
    await submitMessage(page, messageInput, `Message ${requestNumber}`);
    await expect(page.locator('[data-role="bot"]')).toHaveCount(requestNumber);
  }
}

test('sends a message, displays the typing state, and renders the reply', async ({
  page,
}): Promise<void> => {
  const messageInput = await openChatPage(page);
  await installTypingStateCheck(page, messageInput);
  const chatResponse = page.waitForResponse(isPostChatResponse);
  await submitMessage(page, messageInput, 'Hello from the browser');
  expect((await chatResponse).status()).toBe(200);
  await expectRenderedMessage(page, 'user', 'Hello from the browser');
  await expectRenderedMessage(page, 'bot', 'Bot: Hello from the browser');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(messageInput).toBeFocused();
});

test('keeps the message available for retry after a network failure', async ({
  page,
}): Promise<void> => {
  await page.route('**/chat', abortChatRequest);
  const messageInput = await openChatPage(page);
  await submitMessage(page, messageInput, 'Please retry this');
  await expect(page.getByRole('alert')).toHaveText('Connection lost, please retry.');
  await expect(messageInput).toHaveValue('Please retry this');
  await expectRenderedMessage(page, 'user', 'Please retry this');
  await expect(messageInput).toBeFocused();
});

test.describe('rate-limited server', (): void => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('shows a safe error after the sixth message in one minute', async ({
    page,
  }): Promise<void> => {
    const messageInput = await openChatPage(page);
    await sendSuccessfulMessages(page, messageInput);
    const throttledResponse = page.waitForResponse(isThrottledChatResponse);
    await submitMessage(page, messageInput, 'Message 6');
    expect((await throttledResponse).status()).toBe(429);
    await expect(page.getByRole('alert')).toHaveText('Too many messages, please try again later.');
    await expect(messageInput).toHaveValue('Message 6');
  });
});
