import { Pool, PoolClient } from 'pg';
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

/* eslint-disable @typescript-eslint/no-explicit-any */
const toType = (r: any): ResourceType => ({
  id: r.id,
  name: r.name,
  description: r.description,
  createdAt: new Date(r.created_at).toISOString()
});
const toAction = (r: any): ActionRecord => ({
  actionId: r.action_id,
  kind: r.kind,
  playerId: r.player_id,
  nodeId: r.node_id,
  reason: r.reason,
  items: r.items,
  balancesAfter: r.balances_after,
  fingerprint: r.fingerprint,
  createdAt: new Date(r.created_at).toISOString()
});

class DuplicateAction extends Error {}

export class PostgresResourceRepository implements ResourceRepository {
  constructor(private readonly pool: Pool) {}

  async listTypes() {
    const { rows } = await this.pool.query('SELECT * FROM resource_types ORDER BY id');
    return rows.map(toType);
  }
  async getType(id: string) {
    const { rows } = await this.pool.query('SELECT * FROM resource_types WHERE id = $1', [id]);
    return rows[0] ? toType(rows[0]) : null;
  }
  async createType(t: ResourceType) {
    const { rows } = await this.pool.query(
      `INSERT INTO resource_types (id, name, description) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [t.id, t.name, t.description]
    );
    if (!rows[0]) throw conflict('RESOURCE_TYPE_EXISTS', `Resource type '${t.id}' already exists`);
    return toType(rows[0]);
  }
  async updateType(id: string, patch: { name?: string; description?: string }) {
    const { rows } = await this.pool.query(
      `UPDATE resource_types SET name = COALESCE($2, name), description = COALESCE($3, description)
       WHERE id = $1 RETURNING *`,
      [id, patch.name ?? null, patch.description ?? null]
    );
    return rows[0] ? toType(rows[0]) : null;
  }
  async deleteType(id: string) {
    try {
      const res = await this.pool.query('DELETE FROM resource_types WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    } catch (e: any) {
      if (e.code === '23503') throw conflict('RESOURCE_TYPE_IN_USE', `Resource type '${id}' is still held by players or nodes`);
      throw e;
    }
  }

  async getBalances(playerId: string): Promise<Balance[]> {
    const { rows } = await this.pool.query(
      'SELECT player_id, resource_type_id, quantity FROM player_resources WHERE player_id = $1 ORDER BY resource_type_id',
      [playerId]
    );
    return rows.map((r) => ({ playerId: r.player_id, resourceTypeId: r.resource_type_id, quantity: r.quantity }));
  }
  async setBalance(b: Balance) {
    await this.pool.query(
      `INSERT INTO player_resources (player_id, resource_type_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (player_id, resource_type_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
      [b.playerId, b.resourceTypeId, b.quantity]
    );
    return b;
  }

  async getNodeStocks(nodeId: string): Promise<NodeStock[]> {
    const { rows } = await this.pool.query(
      'SELECT node_id, resource_type_id, quantity FROM node_resources WHERE node_id = $1 ORDER BY resource_type_id',
      [nodeId]
    );
    return rows.map((r) => ({ nodeId: r.node_id, resourceTypeId: r.resource_type_id, quantity: r.quantity }));
  }
  async setNodeStock(s: NodeStock) {
    await this.pool.query(
      `INSERT INTO node_resources (node_id, resource_type_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (node_id, resource_type_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
      [s.nodeId, s.resourceTypeId, s.quantity]
    );
    return s;
  }

  async getAction(actionId: string) {
    const { rows } = await this.pool.query('SELECT * FROM resource_actions WHERE action_id = $1', [actionId]);
    return rows[0] ? toAction(rows[0]) : null;
  }
  async listActions(f: ActionFilter) {
    const { rows } = await this.pool.query(
      `SELECT * FROM resource_actions
       WHERE ($1::text IS NULL OR player_id = $1) AND ($2::text IS NULL OR kind = $2) AND ($3::text IS NULL OR node_id = $3)
       ORDER BY created_at DESC LIMIT $4`,
      [f.playerId ?? null, f.kind ?? null, f.nodeId ?? null, f.limit]
    );
    return rows.map(toAction);
  }

  async applyGather(cmd: GatherCommand): Promise<ApplyResult> {
    return this.inActionTx(cmd.actionId, async (c) => {
      await this.claimAction(c, cmd, 'GATHER', cmd.nodeId, null, [{ resourceTypeId: cmd.resourceTypeId, amount: cmd.amount }]);

      const stock = await c.query(
        'SELECT quantity FROM node_resources WHERE node_id = $1 AND resource_type_id = $2 FOR UPDATE',
        [cmd.nodeId, cmd.resourceTypeId]
      );
      if (stock.rows[0]) {
        const available: number = stock.rows[0].quantity;
        if (available < cmd.amount) {
          throw unprocessable('NODE_DEPLETED', `Node '${cmd.nodeId}' has only ${available} ${cmd.resourceTypeId}`, {
            available,
            requested: cmd.amount
          });
        }
        await c.query(
          'UPDATE node_resources SET quantity = quantity - $3, updated_at = now() WHERE node_id = $1 AND resource_type_id = $2',
          [cmd.nodeId, cmd.resourceTypeId, cmd.amount]
        );
      }
      const bal = await c.query(
        `INSERT INTO player_resources (player_id, resource_type_id, quantity) VALUES ($1, $2, $3)
         ON CONFLICT (player_id, resource_type_id)
         DO UPDATE SET quantity = player_resources.quantity + EXCLUDED.quantity, updated_at = now()
         RETURNING quantity`,
        [cmd.playerId, cmd.resourceTypeId, cmd.amount]
      );
      return [{ playerId: cmd.playerId, resourceTypeId: cmd.resourceTypeId, quantity: bal.rows[0].quantity }];
    });
  }

  async applyConsume(cmd: ConsumeCommand): Promise<ApplyResult> {
    return this.inActionTx(cmd.actionId, async (c) => {
      await this.claimAction(c, cmd, 'CONSUME', null, cmd.reason, cmd.items);

      // Lock the player's rows in a stable order (items are sorted) to avoid deadlocks.
      const ids = cmd.items.map((i) => i.resourceTypeId);
      const { rows } = await c.query(
        `SELECT resource_type_id, quantity FROM player_resources
         WHERE player_id = $1 AND resource_type_id = ANY($2::text[]) ORDER BY resource_type_id FOR UPDATE`,
        [cmd.playerId, ids]
      );
      const have = new Map<string, number>(rows.map((r) => [r.resource_type_id, r.quantity]));
      const missing = cmd.items
        .map((it) => ({ resourceTypeId: it.resourceTypeId, required: it.amount, available: have.get(it.resourceTypeId) ?? 0 }))
        .filter((m) => m.available < m.required);
      if (missing.length) throw unprocessable('INSUFFICIENT_RESOURCES', 'Not enough resources', { missing });

      const after: Balance[] = [];
      for (const it of cmd.items) {
        const r = await c.query(
          `UPDATE player_resources SET quantity = quantity - $3, updated_at = now()
           WHERE player_id = $1 AND resource_type_id = $2 RETURNING quantity`,
          [cmd.playerId, it.resourceTypeId, it.amount]
        );
        after.push({ playerId: cmd.playerId, resourceTypeId: it.resourceTypeId, quantity: r.rows[0].quantity });
      }
      return after;
    });
  }

  /**
   * Runs `work` in a transaction. The action row is inserted FIRST: a concurrent
   * request with the same actionId blocks on the primary key until we commit or
   * roll back, so the same action can never be applied twice.
   */
  private async inActionTx(actionId: string, work: (c: PoolClient) => Promise<Balance[]>): Promise<ApplyResult> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const balancesAfter = await work(c);
      const { rows } = await c.query(
        'UPDATE resource_actions SET balances_after = $2 WHERE action_id = $1 RETURNING *',
        [actionId, JSON.stringify(balancesAfter)]
      );
      await c.query('COMMIT');
      return { action: toAction(rows[0]), duplicate: false };
    } catch (e) {
      await c.query('ROLLBACK');
      if (e instanceof DuplicateAction) {
        const existing = await this.getAction(actionId);
        return { action: existing!, duplicate: true };
      }
      throw e;
    } finally {
      c.release();
    }
  }

  private async claimAction(
    c: PoolClient,
    cmd: { actionId: string; playerId: string; fingerprint: string },
    kind: 'GATHER' | 'CONSUME',
    nodeId: string | null,
    reason: string | null,
    items: unknown
  ) {
    const { rowCount } = await c.query(
      `INSERT INTO resource_actions (action_id, kind, player_id, node_id, reason, items, fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (action_id) DO NOTHING`,
      [cmd.actionId, kind, cmd.playerId, nodeId, reason, JSON.stringify(items), cmd.fingerprint]
    );
    if (rowCount === 0) throw new DuplicateAction();
  }
}
