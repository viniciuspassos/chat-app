import { z } from 'zod';

export const toolStatusSchema = z.enum(['running', 'done', 'error']);
export type ToolStatus = z.infer<typeof toolStatusSchema>;

export const textBlockSchema = z.object({ type: z.literal('text'), text: z.string() });
export const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  server: z.enum(['search', 'writer']),
});
export const toolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  toolUseId: z.string().min(1),
  content: z.string(),
  isError: z.boolean(),
});
export const fileBlockSchema = z.object({
  type: z.literal('file'),
  id: z.string().uuid(),
  path: z.string().min(1),
  downloadUrl: z.string().startsWith('/api/files/'),
  name: z.string().min(1),
  mediaType: z.string().min(1),
});
export const summaryBlockSchema = z.object({
  type: z.literal('summary'),
  text: z.string().min(1),
  throughExchangeId: z.string().min(1),
  tokenCount: z.number().int().positive(),
});
export const contentBlockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  toolUseBlockSchema,
  toolResultBlockSchema,
  fileBlockSchema,
  summaryBlockSchema,
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const canonicalDeltaSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('content_block_start'),
    index: z.number().int().nonnegative(),
    block: z.enum(['text', 'tool_use']),
    id: z.string().optional(),
    name: z.string().optional(),
    server: z.enum(['search', 'writer']).optional(),
  }),
  z.object({
    type: z.literal('text_delta'),
    index: z.number().int().nonnegative(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('input_json_delta'),
    index: z.number().int().nonnegative(),
    delta: z.string(),
  }),
  z.object({ type: z.literal('content_block_stop'), index: z.number().int().nonnegative() }),
  z.object({ type: z.literal('message_delta'), stopReason: z.enum(['tool_use', 'end_turn']) }),
]);
export type CanonicalDelta = z.infer<typeof canonicalDeltaSchema>;

export const canonicalDeltaEventSchema = z.object({
  type: z.literal('canonical_delta'),
  delta: canonicalDeltaSchema,
});
export const sseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turn'), turnId: z.string().uuid() }),
  z.object({
    type: z.literal('text'),
    blockIndex: z.number().int().nonnegative(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('tool'),
    toolUseId: z.string(),
    name: z.string(),
    server: z.enum(['search', 'writer']),
    status: toolStatusSchema,
  }),
  z.object({
    type: z.literal('file_progress'),
    path: z.string(),
    bytesWritten: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('file'),
    artifactId: z.string().uuid(),
    path: z.string(),
    downloadUrl: z.string().startsWith('/api/files/'),
  }),
  z.object({
    type: z.literal('done'),
    turnId: z.string().uuid(),
    exchangeIndex: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('error'), code: z.string().min(1), message: z.string().min(1) }),
]);
export type SseEvent = z.infer<typeof sseEventSchema>;
export const internalTurnEventSchema = z.union([sseEventSchema, canonicalDeltaEventSchema]);
export type InternalTurnEvent = z.infer<typeof internalTurnEventSchema>;
