export interface ResourceType {
  id: string; // e.g. "wood", "metal_scraps"
  name: string;
  description: string;
  createdAt: string;
}

export interface Balance {
  playerId: string;
  resourceTypeId: string;
  quantity: number;
}

export interface NodeStock {
  nodeId: string;
  resourceTypeId: string;
  quantity: number;
}

export interface ResourceAmount {
  resourceTypeId: string;
  amount: number;
}

export type ActionKind = 'GATHER' | 'CONSUME';

export const CONSUME_REASONS = [
  'BARRICADE',
  'BASE_UPGRADE',
  'FACILITY',
  'STORAGE',
  'DECORATION',
  'CRAFT',
  'FEED_KIKI',
  'OTHER'
] as const;
export type ConsumeReason = (typeof CONSUME_REASONS)[number];

/** One applied gather/consume. Stored forever: this is what makes operations idempotent. */
export interface ActionRecord {
  actionId: string;
  kind: ActionKind;
  playerId: string;
  nodeId: string | null; // where it was gathered (GATHER only)
  reason: string | null; // why it was spent (CONSUME only)
  items: ResourceAmount[];
  balancesAfter: Balance[];
  fingerprint: string; // normalized request, detects actionId reuse with a different payload
  createdAt: string;
}

export interface GatherCommand {
  actionId: string;
  playerId: string;
  nodeId: string;
  resourceTypeId: string;
  amount: number;
  fingerprint: string;
}

export interface ConsumeCommand {
  actionId: string;
  playerId: string;
  reason: ConsumeReason;
  items: ResourceAmount[]; // already merged, one entry per resource type
  fingerprint: string;
}

export interface ApplyResult {
  action: ActionRecord;
  duplicate: boolean;
}

/** Sums duplicate resource types and sorts by id (stable lock order in the DB). */
export function mergeAmounts(items: ResourceAmount[]): ResourceAmount[] {
  const totals = new Map<string, number>();
  for (const it of items) totals.set(it.resourceTypeId, (totals.get(it.resourceTypeId) ?? 0) + it.amount);
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resourceTypeId, amount]) => ({ resourceTypeId, amount }));
}
