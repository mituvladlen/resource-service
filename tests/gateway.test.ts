import request from 'supertest';
import { createApp } from '../src/app';
import { HttpPlayerClient, MockPlayerClient } from '../src/clients/playerClient';
import { HttpWorldClient, MockWorldClient } from '../src/clients/worldClient';
import { loadConfig } from '../src/config';
import { MemoryResourceRepository } from '../src/repositories/memoryResourceRepository';
import { ResourceService } from '../src/services/resourceService';
import { makeApp } from './helpers';

afterEach(() => jest.restoreAllMocks());

const svc = () => new ResourceService(new MemoryResourceRepository(), new MockPlayerClient(), new MockWorldClient());

describe('limits in the app (Lab 2)', () => {
  it('keeps /health outside the concurrency limit', async () => {
    const app = createApp(svc(), { requestTimeoutMs: 1000, maxConcurrentRequests: 0 });
    expect((await request(app).get('/health')).status).toBe(200);
    const r = await request(app).get('/resource-types');
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('TOO_MANY_REQUESTS');
  });

  it('answers 408 and ignores a handler that fails after the timeout', async () => {
    const s = svc();
    jest.spyOn(s, 'listTypes').mockImplementation(() => new Promise((_ok, fail) => setTimeout(() => fail(new Error('late')), 60)));
    const r = await request(createApp(s, { requestTimeoutMs: 20, maxConcurrentRequests: 10 })).get('/resource-types');
    expect(r.status).toBe(408);
    await new Promise((done) => setTimeout(done, 80));
  });
});

describe('no auth downstream (Lab 2)', () => {
  it('works without an Authorization header (the Gateway strips it)', async () => {
    const { api } = await makeApp();
    const r = await api().get('/players/player-1/resources').set('X-User-Id', 'player-1');
    expect(r.status).toBe(200);
  });
});

describe('calls through the Gateway (Lab 2)', () => {
  it('sends the service token', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    await new HttpPlayerClient('http://gateway:8080/player', { token: 'svc-jwt' }).playerExists('p1');
    expect(spy).toHaveBeenCalledWith(
      'http://gateway:8080/player/players/p1',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer svc-jwt' }) })
    );
  });

  it('maps an upstream timeout to 504', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(Object.assign(new Error('slow'), { name: 'TimeoutError' }));
    await expect(new HttpWorldClient('http://gateway:8080/world').getNode('n')).rejects.toMatchObject({ status: 504, code: 'UPSTREAM_TIMEOUT' });
  });

  it('reads limits, token and Gateway URLs from env', () => {
    expect(loadConfig({})).toMatchObject({
      requestTimeoutMs: 5000,
      maxConcurrentRequests: 100,
      serviceToken: '',
      playerServiceUrl: 'http://gateway:8080/player',
      worldServiceUrl: 'http://gateway:8080/world'
    });
    expect(loadConfig({ REQUEST_TIMEOUT_MS: '100', MAX_CONCURRENT_REQUESTS: '2', OUTGOING_TIMEOUT_MS: '50', SERVICE_TOKEN: 't' })).toMatchObject({
      requestTimeoutMs: 100,
      maxConcurrentRequests: 2,
      outgoingTimeoutMs: 50,
      serviceToken: 't'
    });
  });
});
