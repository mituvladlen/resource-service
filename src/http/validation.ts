import { z } from 'zod';
import { CONSUME_REASONS } from '../domain/types';

const id = z.string().trim().min(1).max(100);
const qty = z.number().int().min(0).max(1_000_000);
const positive = z.number().int().min(1).max(10_000);

export const createTypeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,49}$/, 'lowercase letters, digits, underscore (2-50 chars)'),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional()
});
export const updateTypeSchema = z
  .object({ name: z.string().trim().min(1).max(100).optional(), description: z.string().max(500).optional() })
  .refine((v) => v.name !== undefined || v.description !== undefined, 'provide name and/or description');

export const setQuantitySchema = z.object({ quantity: qty });

export const gatherSchema = z.object({
  actionId: id,
  playerId: id,
  nodeId: id,
  amount: positive,
  resourceTypeId: id.optional()
});

export const consumeSchema = z.object({
  actionId: id,
  playerId: id,
  reason: z.enum(CONSUME_REASONS),
  items: z.array(z.object({ resourceTypeId: id, amount: positive })).min(1).max(20)
});

export const listActionsSchema = z.object({
  playerId: id.optional(),
  nodeId: id.optional(),
  kind: z.enum(['GATHER', 'CONSUME']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});
