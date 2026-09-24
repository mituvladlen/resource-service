import { conflict, unprocessable } from '../errors';
import {
  ActionRecord,
  ApplyResult,
  Balance,
  ConsumeCommand,
  GatherCommand,
  NodeStock,
  ResourceType
} from '../domain/types';
import { ActionFilter, ResourceRepository } from './resourceRepository';

const key = (a: string, b: string) => `${a}::${b}`;

/**
 * In-memory store. The apply* methods contain no `await`, so on Node's single
 * thread they run to completion without interleaving: that makes them atomic.
 */
export class MemoryResourceRepository implements ResourceRepository {
  private types = new Map<string, ResourceType>();
  private balances = new Map<string, Balance>();
  private stocks = new Map<string, NodeStock>();
  private actions = new Map<string, ActionRecord>();
  private actionOrder: string[] = [];

  async listTypes() {
    return [...this.types.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  async getType(id: string) {
    return this.types.get(id) ?? null;
  }
  async createType(type: ResourceType) {
    if (this.types.has(type.id)) throw conflict('RESOURCE_TYPE_EXISTS', `Resource type '${type.id}' already exists`);
    this.types.set(type.id, { ...type });
    return { ...type };
  }
  async updateType(id: string, patch: { name?: string; description?: string }) {
    const t = this.types.get(id);
    if (!t) return null;
    const updated = { ...t, ...patch };
    this.types.set(id, updated);
    return { ...updated };
  }
  async deleteType(id: string) {
    if (!this.types.has(id)) return false;
    const used = [...this.balances.values(), ...this.stocks.values()].some((x) => x.resourceTypeId === id);
    if (used) throw conflict('RESOURCE_TYPE_IN_USE', `Resource type '${id}' is still held by players or nodes`);
    this.types.delete(id);
    return true;
  }

  async getBalances(playerId: string) {
    return [...this.balances.values()].filter((b) => b.playerId === playerId).map((b) => ({ ...b }));
  }
  async setBalance(balance: Balance) {
    this.balances.set(key(balance.playerId, balance.resourceTypeId), { ...balance });
    return { ...balance };
  }

  async getNodeStocks(nodeId: string) {
    return [...this.stocks.values()].filter((s) => s.nodeId === nodeId).map((s) => ({ ...s }));
  }
  async setNodeStock(stock: NodeStock) {
    this.stocks.set(key(stock.nodeId, stock.resourceTypeId), { ...stock });
    return { ...stock };
  }

  async getAction(actionId: string) {
    return this.actions.get(actionId) ?? null;
  }
  async listActions(f: ActionFilter) {
    return this.actionOrder
      .map((id) => this.actions.get(id)!)
      .filter((a) => (!f.playerId || a.playerId === f.playerId) && (!f.kind || a.kind === f.kind))
      .filter((a) => !f.nodeId || a.nodeId === f.nodeId)
      .reverse()
      .slice(0, f.limit);
  }

  async applyGather(cmd: GatherCommand): Promise<ApplyResult> {
    const existing = this.actions.get(cmd.actionId);
    if (existing) return { action: existing, duplicate: true };

    const stockKey = key(cmd.nodeId, cmd.resourceTypeId);
    const stock = this.stocks.get(stockKey);
    // A node without a stock row is treated as unlimited.
    if (stock && stock.quantity < cmd.amount) {
      throw unprocessable('NODE_DEPLETED', `Node '${cmd.nodeId}' has only ${stock.quantity} ${cmd.resourceTypeId}`, {
        available: stock.quantity,
        requested: cmd.amount
      });
    }
    if (stock) stock.quantity -= cmd.amount;

    const balKey = key(cmd.playerId, cmd.resourceTypeId);
    const bal = this.balances.get(balKey) ?? { playerId: cmd.playerId, resourceTypeId: cmd.resourceTypeId, quantity: 0 };
    bal.quantity += cmd.amount;
    this.balances.set(balKey, bal);

    return { action: this.record(cmd, 'GATHER', cmd.nodeId, null, [{ resourceTypeId: cmd.resourceTypeId, amount: cmd.amount }], [{ ...bal }]), duplicate: false };
  }

  async applyConsume(cmd: ConsumeCommand): Promise<ApplyResult> {
    const existing = this.actions.get(cmd.actionId);
    if (existing) return { action: existing, duplicate: true };

    // Check everything first, change nothing unless every item is affordable.
    const missing = cmd.items
      .map((it) => ({
        resourceTypeId: it.resourceTypeId,
        required: it.amount,
        available: this.balances.get(key(cmd.playerId, it.resourceTypeId))?.quantity ?? 0
      }))
      .filter((m) => m.available < m.required);
    if (missing.length) throw unprocessable('INSUFFICIENT_RESOURCES', 'Not enough resources', { missing });

    const after: Balance[] = cmd.items.map((it) => {
      const bal = this.balances.get(key(cmd.playerId, it.resourceTypeId))!;
      bal.quantity -= it.amount;
      return { ...bal };
    });
    return { action: this.record(cmd, 'CONSUME', null, cmd.reason, cmd.items, after), duplicate: false };
  }

  private record(
    cmd: { actionId: string; playerId: string; fingerprint: string },
    kind: 'GATHER' | 'CONSUME',
    nodeId: string | null,
    reason: string | null,
    items: ActionRecord['items'],
    balancesAfter: Balance[]
  ): ActionRecord {
    const action: ActionRecord = {
      actionId: cmd.actionId,
      kind,
      playerId: cmd.playerId,
      nodeId,
      reason,
      items,
      balancesAfter,
      fingerprint: cmd.fingerprint,
      createdAt: new Date().toISOString()
    };
    this.actions.set(action.actionId, action);
    this.actionOrder.push(action.actionId);
    return action;
  }
}
