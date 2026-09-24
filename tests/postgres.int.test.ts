/**
 * Integration test against a real PostgreSQL. Skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5433/resource_test npx jest postgres
 */
import { Pool } from 'pg';
import { migrate, seed } from '../src/db/pool';
import { PostgresResourceRepository } from '../src/repositories/postgresResourceRepository';
import { ResourceService } from '../src/services/resourceService';
import { MockPlayerClient } from '../src/clients/playerClient';
import { MockWorldClient } from '../src/clients/worldClient';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('PostgresResourceRepository', () => {
  let pool: Pool;
  let svc: ResourceService;
  let repo: PostgresResourceRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(pool);
    await pool.query('DROP TABLE IF EXISTS resource_actions, player_resources, node_resources, resource_types');
    await migrate(pool);
    await seed(pool);
    await seed(pool); // second run must be a no-op
    repo = new PostgresResourceRepository(pool);
    svc = new ResourceService(repo, new MockPlayerClient(), new MockWorldClient());
  });
  afterAll(() => pool.end());

  it('seeded exactly once', async () => {
    expect((await repo.listTypes()).map((t) => t.id)).toEqual(['food', 'metal_scraps', 'paper', 'wood']);
    expect((await svc.getPlayerResource('player-1', 'wood')).quantity).toBe(30);
  });

  it('gather is idempotent, even with concurrent duplicates', async () => {
    const cmd = { actionId: 'pg-g1', playerId: 'player-1', nodeId: 'node-cafeteria', amount: 12 };
    const results = await Promise.all(Array.from({ length: 6 }, () => svc.gather(cmd)));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect((await svc.getPlayerResource('player-1', 'food')).quantity).toBe(22);
    expect((await repo.getNodeStocks('node-cafeteria'))[0].quantity).toBe(388);
    await expect(svc.gather({ ...cmd, amount: 1 })).rejects.toMatchObject({ status: 409 });
  });

  it('gather on a node without stock row, and depleted nodes', async () => {
    await repo.setNodeStock({ nodeId: 'node-library', resourceTypeId: 'paper', quantity: 2 });
    await expect(svc.gather({ actionId: 'pg-g2', playerId: 'player-2', nodeId: 'node-library', amount: 3 })).rejects.toMatchObject({
      code: 'NODE_DEPLETED'
    });
    expect(await repo.getAction('pg-g2')).toBeNull(); // rolled back, actionId not burned
    await pool.query("DELETE FROM node_resources WHERE node_id = 'node-library'");
    const r = await svc.gather({ actionId: 'pg-g2', playerId: 'player-2', nodeId: 'node-library', amount: 3 });
    expect(r.action.balancesAfter[0].quantity).toBe(18);
  });

  it('consume is all-or-nothing and idempotent', async () => {
    const bad = { actionId: 'pg-c1', playerId: 'player-3', reason: 'BASE_UPGRADE' as const, items: [
      { resourceTypeId: 'wood', amount: 5 }, { resourceTypeId: 'metal_scraps', amount: 99 }
    ] };
    await expect(svc.consume(bad)).rejects.toMatchObject({ code: 'INSUFFICIENT_RESOURCES' });
    expect((await svc.getPlayerResource('player-3', 'wood')).quantity).toBe(10);

    const ok = { ...bad, actionId: 'pg-c2', items: [{ resourceTypeId: 'wood', amount: 5 }, { resourceTypeId: 'metal_scraps', amount: 5 }] };
    const results = await Promise.all([svc.consume(ok), svc.consume(ok), svc.consume(ok)]);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect((await svc.getPlayerResource('player-3', 'wood')).quantity).toBe(5);
    expect((await svc.getPlayerResource('player-3', 'metal_scraps')).quantity).toBe(0);
  });

  it('parallel different consumes cannot overdraw', async () => {
    await repo.setBalance({ playerId: 'player-2', resourceTypeId: 'food', quantity: 10 });
    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        svc.consume({ actionId: `pg-par-${i}`, playerId: 'player-2', reason: 'FEED_KIKI', items: [{ resourceTypeId: 'food', amount: 3 }] })
      )
    );
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(3);
    expect((await svc.getPlayerResource('player-2', 'food')).quantity).toBe(1);
  });

  it('types CRUD and history', async () => {
    await svc.createType({ id: 'chemicals', name: 'Chemicals' });
    await expect(svc.createType({ id: 'chemicals', name: 'x' })).rejects.toMatchObject({ status: 409 });
    expect((await svc.updateType('chemicals', { description: 'lab' })).description).toBe('lab');
    await svc.deleteType('chemicals');
    await expect(svc.deleteType('wood')).rejects.toMatchObject({ code: 'RESOURCE_TYPE_IN_USE' });
    expect(await repo.updateType('nope', { name: 'x' })).toBeNull();
    const hist = await svc.listActions({ playerId: 'player-1', kind: 'GATHER', limit: 10 });
    expect(hist[0]).toMatchObject({ actionId: 'pg-g1', nodeId: 'node-cafeteria' });
  });
});
