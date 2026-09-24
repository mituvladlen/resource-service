import request from 'supertest';
import { makeApp } from './helpers';

const gather = (overrides: object = {}) => ({
  actionId: 'act-1',
  playerId: 'player-1',
  nodeId: 'node-cafeteria',
  amount: 12,
  ...overrides
});

describe('POST /gather', () => {
  it('awards resources and records where they were gathered', async () => {
    const { app } = await makeApp();
    const res = await request(app).post('/gather').send(gather());
    expect(res.status).toBe(201);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.action).toMatchObject({
      kind: 'GATHER',
      nodeId: 'node-cafeteria',
      items: [{ resourceTypeId: 'food', amount: 12 }],
      balancesAfter: [{ playerId: 'player-1', resourceTypeId: 'food', quantity: 12 }]
    });
    const hist = await request(app).get('/actions').query({ playerId: 'player-1', kind: 'GATHER' });
    expect(hist.body).toHaveLength(1);
    expect(hist.body[0].nodeId).toBe('node-cafeteria');
  });

  it('is idempotent: the same actionId twice awards only once', async () => {
    const { app } = await makeApp();
    const first = await request(app).post('/gather').send(gather());
    const second = await request(app).post('/gather').send(gather());
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.action).toEqual(first.body.action);
    const bal = await request(app).get('/players/player-1/resources/food');
    expect(bal.body.quantity).toBe(12);
  });

  it('is idempotent under concurrent duplicate completions', async () => {
    const { app } = await makeApp();
    const results = await Promise.all(Array.from({ length: 5 }, () => request(app).post('/gather').send(gather())));
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    const bal = await request(app).get('/players/player-1/resources/food');
    expect(bal.body.quantity).toBe(12);
  });

  it('rejects reuse of an actionId with a different payload (409)', async () => {
    const { app } = await makeApp();
    await request(app).post('/gather').send(gather());
    const res = await request(app).post('/gather').send(gather({ amount: 99 }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACTION_ID_REUSED');
  });

  it('decrements node stock and rejects when the node is depleted', async () => {
    const { app } = await makeApp();
    await request(app).put('/nodes/node-cafeteria/resources/food').send({ quantity: 15 }).expect(200);
    await request(app).post('/gather').send(gather()).expect(201);
    const node = await request(app).get('/nodes/node-cafeteria/resources');
    expect(node.body.stocks).toEqual([{ nodeId: 'node-cafeteria', resourceTypeId: 'food', quantity: 3 }]);
    const res = await request(app).post('/gather').send(gather({ actionId: 'act-2', amount: 4 }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NODE_DEPLETED');
  });

  it('validates player, node and resource type', async () => {
    const { app } = await makeApp();
    expect((await request(app).post('/gather').send(gather({ playerId: 'ghost' }))).body.error.code).toBe('PLAYER_NOT_FOUND');
    expect((await request(app).post('/gather').send(gather({ nodeId: 'nowhere' }))).status).toBe(404);
    const wrong = await request(app).post('/gather').send(gather({ resourceTypeId: 'wood' }));
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('RESOURCE_NOT_AT_NODE');
    await request(app).post('/gather').send(gather({ resourceTypeId: 'food', actionId: 'ok' })).expect(201);
  });

  it('rejects a node that yields an unknown resource type', async () => {
    const { ResourceService } = await import('../src/services/resourceService');
    const { MemoryResourceRepository } = await import('../src/repositories/memoryResourceRepository');
    const { MockPlayerClient } = await import('../src/clients/playerClient');
    const { MockWorldClient } = await import('../src/clients/worldClient');
    // empty repo: node-cafeteria yields "food", which is not a known type here
    const svc = new ResourceService(new MemoryResourceRepository(), new MockPlayerClient(), new MockWorldClient());
    await expect(svc.gather({ actionId: 'x', playerId: 'player-1', nodeId: 'node-cafeteria', amount: 1 })).rejects.toMatchObject({
      code: 'UNKNOWN_RESOURCE_TYPE'
    });
  });

  it('returns 400 for invalid bodies', async () => {
    const { app } = await makeApp();
    const res = await request(app).post('/gather').send({ actionId: 'a', playerId: 'player-1', nodeId: 'n', amount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
