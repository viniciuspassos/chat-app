export function normalizeChatInput(input: string): string {
  const normalizedInput = input.trim();
  return normalizedInput;
}

export function getSafeChatError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Service unavailable, please retry.';
}

export function scrollTranscriptToBottom(transcript: HTMLElement): void {
  const bottomOffset = transcript.scrollHeight;
  transcript.scrollTop = bottomOffset;
}
