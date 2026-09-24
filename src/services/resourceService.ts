import { conflict, notFound, unprocessable } from '../errors';
import {
  ActionRecord,
  ApplyResult,
  Balance,
  ConsumeReason,
  mergeAmounts,
  ResourceAmount,
  ResourceType
} from '../domain/types';
import { PlayerClient } from '../clients/playerClient';
import { WorldClient } from '../clients/worldClient';
import { ActionFilter, ResourceRepository } from '../repositories/resourceRepository';

export interface GatherInput {
  actionId: string;
  playerId: string;
  nodeId: string;
  amount: number;
  resourceTypeId?: string; // optional sanity check against the node's type
}

export interface ConsumeInput {
  actionId: string;
  playerId: string;
  reason: ConsumeReason;
  items: ResourceAmount[];
}

export class ResourceService {
  constructor(
    private readonly repo: ResourceRepository,
    private readonly players: PlayerClient,
    private readonly world: WorldClient
  ) {}

  // ---------- resource types (CRUD) ----------
  listTypes() {
    return this.repo.listTypes();
  }
  async getType(id: string) {
    const t = await this.repo.getType(id);
    if (!t) throw notFound('RESOURCE_TYPE_NOT_FOUND', `Resource type '${id}' not found`);
    return t;
  }
  createType(input: { id: string; name: string; description?: string }): Promise<ResourceType> {
    return this.repo.createType({
      id: input.id,
      name: input.name,
      description: input.description ?? '',
      createdAt: new Date().toISOString()
    });
  }
  async updateType(id: string, patch: { name?: string; description?: string }) {
    const t = await this.repo.updateType(id, patch);
    if (!t) throw notFound('RESOURCE_TYPE_NOT_FOUND', `Resource type '${id}' not found`);
    return t;
  }
  async deleteType(id: string) {
    if (!(await this.repo.deleteType(id))) throw notFound('RESOURCE_TYPE_NOT_FOUND', `Resource type '${id}' not found`);
  }

  // ---------- player quantities ----------
  /** All known resource types, with 0 for the ones the player does not hold. */
  async getPlayerResources(playerId: string): Promise<Balance[]> {
    await this.requirePlayer(playerId);
    const [types, balances] = await Promise.all([this.repo.listTypes(), this.repo.getBalances(playerId)]);
    const held = new Map(balances.map((b) => [b.resourceTypeId, b.quantity]));
    return types.map((t) => ({ playerId, resourceTypeId: t.id, quantity: held.get(t.id) ?? 0 }));
  }
  async getPlayerResource(playerId: string, resourceTypeId: string): Promise<Balance> {
    const all = await this.getPlayerResources(playerId);
    const b = all.find((x) => x.resourceTypeId === resourceTypeId);
    if (!b) throw notFound('RESOURCE_TYPE_NOT_FOUND', `Resource type '${resourceTypeId}' not found`);
    return b;
  }
  /** Admin/debug: overwrite a quantity. Game flows must use gather/consume. */
  async setPlayerResource(playerId: string, resourceTypeId: string, quantity: number) {
    await this.requirePlayer(playerId);
    await this.getType(resourceTypeId);
    return this.repo.setBalance({ playerId, resourceTypeId, quantity });
  }

  // ---------- node quantities ----------
  async getNodeResources(nodeId: string) {
    const node = await this.requireNode(nodeId);
    return { nodeId, resourceTypeId: node.resourceTypeId, stocks: await this.repo.getNodeStocks(nodeId) };
  }
  async setNodeResource(nodeId: string, resourceTypeId: string, quantity: number) {
    await this.requireNode(nodeId);
    await this.getType(resourceTypeId);
    return this.repo.setNodeStock({ nodeId, resourceTypeId, quantity });
  }

  // ---------- actions ----------
  async getAction(actionId: string): Promise<ActionRecord> {
    const a = await this.repo.getAction(actionId);
    if (!a) throw notFound('ACTION_NOT_FOUND', `Action '${actionId}' not found`);
    return a;
  }
  listActions(filter: ActionFilter) {
    return this.repo.listActions(filter);
  }

  /**
   * Applies the result of a finished gathering action. Calling it again with the
   * same actionId returns the first result (duplicate: true) and awards nothing.
   */
  async gather(input: GatherInput): Promise<ApplyResult> {
    const fingerprint = JSON.stringify({
      kind: 'GATHER',
      playerId: input.playerId,
      nodeId: input.nodeId,
      amount: input.amount,
      resourceTypeId: input.resourceTypeId ?? null
    });
    const early = await this.replayIfKnown(input.actionId, fingerprint);
    if (early) return early;

    await this.requirePlayer(input.playerId);
    const node = await this.requireNode(input.nodeId);
    if (input.resourceTypeId && input.resourceTypeId !== node.resourceTypeId) {
      throw unprocessable(
        'RESOURCE_NOT_AT_NODE',
        `Node '${node.id}' yields '${node.resourceTypeId}', not '${input.resourceTypeId}'`
      );
    }
    if (!(await this.repo.getType(node.resourceTypeId))) {
      throw unprocessable('UNKNOWN_RESOURCE_TYPE', `Node yields unknown resource type '${node.resourceTypeId}'`);
    }
    const result = await this.repo.applyGather({
      actionId: input.actionId,
      playerId: input.playerId,
      nodeId: node.id,
      resourceTypeId: node.resourceTypeId,
      amount: input.amount,
      fingerprint
    });
    return this.checkReplay(result, fingerprint);
  }

  /** Spends resources atomically: either every item is deducted or nothing is. */
  async consume(input: ConsumeInput): Promise<ApplyResult> {
    const items = mergeAmounts(input.items);
    const fingerprint = JSON.stringify({ kind: 'CONSUME', playerId: input.playerId, reason: input.reason, items });
    const early = await this.replayIfKnown(input.actionId, fingerprint);
    if (early) return early;

    await this.requirePlayer(input.playerId);
    const known = new Set((await this.repo.listTypes()).map((t) => t.id));
    const unknown = items.filter((i) => !known.has(i.resourceTypeId)).map((i) => i.resourceTypeId);
    if (unknown.length) throw unprocessable('UNKNOWN_RESOURCE_TYPE', `Unknown resource type(s): ${unknown.join(', ')}`);

    const result = await this.repo.applyConsume({
      actionId: input.actionId,
      playerId: input.playerId,
      reason: input.reason,
      items,
      fingerprint
    });
    return this.checkReplay(result, fingerprint);
  }

  // ---------- helpers ----------
  private async replayIfKnown(actionId: string, fingerprint: string): Promise<ApplyResult | null> {
    const existing = await this.repo.getAction(actionId);
    return existing ? this.checkReplay({ action: existing, duplicate: true }, fingerprint) : null;
  }
  private checkReplay(result: ApplyResult, fingerprint: string): ApplyResult {
    if (result.duplicate && result.action.fingerprint !== fingerprint) {
      throw conflict('ACTION_ID_REUSED', `actionId '${result.action.actionId}' was already used for a different request`);
    }
    return result;
  }
  private async requirePlayer(playerId: string) {
    if (!(await this.players.playerExists(playerId))) throw notFound('PLAYER_NOT_FOUND', `Player '${playerId}' not found`);
  }
  private async requireNode(nodeId: string) {
    const node = await this.world.getNode(nodeId);
    if (!node) throw notFound('NODE_NOT_FOUND', `Node '${nodeId}' not found`);
    return node;
  }
}
