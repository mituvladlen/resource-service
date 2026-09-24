import request from 'supertest';
import { makeApp } from './helpers';

describe('resource types CRUD', () => {
  it('lists, reads, creates, updates and deletes', async () => {
    const { app } = await makeApp();
    expect((await request(app).get('/resource-types')).body.map((t: { id: string }) => t.id)).toEqual([
      'food',
      'metal_scraps',
      'paper',
      'wood'
    ]);
    const created = await request(app).post('/resource-types').send({ id: 'chemicals', name: 'Chemicals' });
    expect(created.status).toBe(201);
    expect(created.body.description).toBe('');
    expect((await request(app).post('/resource-types').send({ id: 'chemicals', name: 'X' })).status).toBe(409);
    expect((await request(app).get('/resource-types/chemicals')).body.name).toBe('Chemicals');
    const upd = await request(app).put('/resource-types/chemicals').send({ description: 'From the chem lab' });
    expect(upd.body).toMatchObject({ name: 'Chemicals', description: 'From the chem lab' });
    await request(app).delete('/resource-types/chemicals').expect(204);
    expect((await request(app).get('/resource-types/chemicals')).status).toBe(404);
  });

  it('handles missing types and bad input', async () => {
    const { app } = await makeApp();
    expect((await request(app).put('/resource-types/nope').send({ name: 'x' })).status).toBe(404);
    expect((await request(app).put('/resource-types/wood').send({})).status).toBe(400);
    expect((await request(app).delete('/resource-types/nope')).status).toBe(404);
    expect((await request(app).post('/resource-types').send({ id: 'Bad Id', name: 'x' })).status).toBe(400);
  });

  it('refuses to delete a type that players still hold', async () => {
    const { app } = await makeApp();
    const res = await request(app).delete('/resource-types/wood');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESOURCE_TYPE_IN_USE');
  });
});

describe('player and node quantities', () => {
  it('returns all types with zeroes for missing ones', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/players/player-1/resources');
    expect(res.body).toContainEqual({ playerId: 'player-1', resourceTypeId: 'paper', quantity: 0 });
    expect(res.body).toContainEqual({ playerId: 'player-1', resourceTypeId: 'wood', quantity: 10 });
    expect((await request(app).get('/players/player-1/resources/gold')).status).toBe(404);
    expect((await request(app).get('/players/ghost/resources')).status).toBe(404);
  });

  it('sets quantities with validation', async () => {
    const { app } = await makeApp();
    await request(app).put('/players/player-2/resources/paper').send({ quantity: 7 }).expect(200);
    expect((await request(app).get('/players/player-2/resources/paper')).body.quantity).toBe(7);
    expect((await request(app).put('/players/player-2/resources/paper').send({ quantity: -1 })).status).toBe(400);
    expect((await request(app).put('/players/player-2/resources/gold').send({ quantity: 1 })).status).toBe(404);
    expect((await request(app).put('/nodes/unknown-node/resources/wood').send({ quantity: 1 })).status).toBe(404);
    expect((await request(app).get('/nodes/node-library/resources')).body).toEqual({
      nodeId: 'node-library',
      resourceTypeId: 'paper',
      stocks: []
    });
  });

  it('reads single actions and 404s', async () => {
    const { app } = await makeApp();
    await request(app).post('/gather').send({ actionId: 'g1', playerId: 'player-1', nodeId: 'node-library', amount: 3 });
    expect((await request(app).get('/actions/g1')).body.kind).toBe('GATHER');
    expect((await request(app).get('/actions/zzz')).status).toBe(404);
    expect((await request(app).get('/actions').query({ nodeId: 'node-library' })).body).toHaveLength(1);
    expect((await request(app).get('/actions').query({ limit: 0 })).status).toBe(400);
  });
});

describe('app plumbing', () => {
  it('health, unknown route, invalid json', async () => {
    const { app } = await makeApp();
    expect((await request(app).get('/health')).body.status).toBe('ok');
    expect((await request(app).get('/nope')).status).toBe(404);
    const bad = await request(app).post('/gather').set('content-type', 'application/json').send('{"broken');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
  });

  it('hides unexpected errors behind 500', async () => {
    const { app, repo } = await makeApp();
    jest.spyOn(repo, 'listTypes').mockRejectedValueOnce(new Error('boom'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await request(app).get('/resource-types');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
