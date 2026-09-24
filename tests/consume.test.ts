import request from 'supertest';
import { makeApp } from './helpers';

const consume = (overrides: object = {}) => ({
  actionId: 'spend-1',
  playerId: 'player-1',
  reason: 'BARRICADE',
  items: [
    { resourceTypeId: 'wood', amount: 5 },
    { resourceTypeId: 'metal_scraps', amount: 2 }
  ],
  ...overrides
});

describe('POST /consume', () => {
  it('deducts every item and returns the new balances', async () => {
    const { app } = await makeApp();
    const res = await request(app).post('/consume').send(consume());
    expect(res.status).toBe(201);
    expect(res.body.action.reason).toBe('BARRICADE');
    expect(res.body.action.balancesAfter).toEqual([
      { playerId: 'player-1', resourceTypeId: 'metal_scraps', quantity: 3 },
      { playerId: 'player-1', resourceTypeId: 'wood', quantity: 5 }
    ]);
  });

  it('rejects when there are not enough resources and changes nothing', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/consume')
      .send(consume({ items: [{ resourceTypeId: 'wood', amount: 5 }, { resourceTypeId: 'metal_scraps', amount: 50 }] }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_RESOURCES');
    expect(res.body.error.details.missing).toEqual([{ resourceTypeId: 'metal_scraps', required: 50, available: 5 }]);
    const wood = await request(app).get('/players/player-1/resources/wood');
    expect(wood.body.quantity).toBe(10); // wood was NOT deducted: all-or-nothing
    // the failed actionId is not burned: it can be retried once the player has enough
    await request(app).put('/players/player-1/resources/metal_scraps').send({ quantity: 50 });
    await request(app)
      .post('/consume')
      .send(consume({ items: [{ resourceTypeId: 'wood', amount: 5 }, { resourceTypeId: 'metal_scraps', amount: 50 }] }))
      .expect(201);
  });

  it('merges repeated items before checking the balance', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/consume')
      .send(consume({ items: [{ resourceTypeId: 'wood', amount: 6 }, { resourceTypeId: 'wood', amount: 6 }] }));
    expect(res.status).toBe(422);
    expect(res.body.error.details.missing[0]).toMatchObject({ required: 12, available: 10 });
  });

  it('never charges twice for the same actionId', async () => {
    const { app } = await makeApp();
    await request(app).post('/consume').send(consume()).expect(201);
    const again = await request(app).post('/consume').send(consume());
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect((await request(app).get('/players/player-1/resources/wood')).body.quantity).toBe(5);
    const reused = await request(app).post('/consume').send(consume({ reason: 'CRAFT' }));
    expect(reused.status).toBe(409);
  });

  it('rejects unknown resource types and unknown players', async () => {
    const { app } = await makeApp();
    const r1 = await request(app).post('/consume').send(consume({ items: [{ resourceTypeId: 'gold', amount: 1 }] }));
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe('UNKNOWN_RESOURCE_TYPE');
    const r2 = await request(app).post('/consume').send(consume({ playerId: 'nobody' }));
    expect(r2.status).toBe(404);
  });

  it('rejects an unknown reason', async () => {
    const { app } = await makeApp();
    expect((await request(app).post('/consume').send(consume({ reason: 'PARTY' }))).status).toBe(400);
  });
});
