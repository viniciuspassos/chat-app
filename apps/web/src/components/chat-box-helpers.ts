export function normalizeChatInput(input: string): string {
  return input.trim();
}

export function getSafeChatError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Service unavailable, please retry.';
}

export function scrollTranscriptToBottom(transcript: HTMLElement): void {
  transcript.scrollTop = transcript.scrollHeight;
}
