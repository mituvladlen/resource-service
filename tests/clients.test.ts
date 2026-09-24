import { HttpPlayerClient, MockPlayerClient } from '../src/clients/playerClient';
import { HttpWorldClient, MockWorldClient } from '../src/clients/worldClient';
import { loadConfig } from '../src/config';
import { mergeAmounts } from '../src/domain/types';

const mockFetch = (impl: () => Promise<Partial<Response>>) =>
  jest.spyOn(global, 'fetch').mockImplementation(impl as unknown as typeof fetch);

afterEach(() => jest.restoreAllMocks());

describe('mocks', () => {
  it('know the fixed players and nodes', async () => {
    expect(await new MockPlayerClient().playerExists('player-3')).toBe(true);
    expect(await new MockPlayerClient(['a']).playerExists('player-1')).toBe(false);
    expect(await new MockWorldClient().getNode('node-library')).toEqual({ id: 'node-library', resourceTypeId: 'paper' });
    expect(await new MockWorldClient().getNode('x')).toBeNull();
  });
});

describe('HTTP clients (Lab 2)', () => {
  it('maps 200 and 404', async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ id: 'n1', resourceTypeId: 'wood' }) }));
    expect(await new HttpWorldClient('http://world').getNode('n1')).toEqual({ id: 'n1', resourceTypeId: 'wood' });
    expect(await new HttpPlayerClient('http://player').playerExists('p')).toBe(true);
    mockFetch(async () => ({ ok: false, status: 404 }));
    expect(await new HttpPlayerClient('http://player').playerExists('p')).toBe(false);
  });

  it('maps upstream failures to 502/503', async () => {
    mockFetch(async () => ({ ok: false, status: 500 }));
    await expect(new HttpWorldClient('http://w').getNode('n')).rejects.toMatchObject({ status: 502 });
    mockFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(new HttpPlayerClient('http://p').playerExists('p')).rejects.toMatchObject({ status: 503 });
  });
});

describe('config and helpers', () => {
  it('reads env with defaults', () => {
    expect(loadConfig({}).mockPlayers).toHaveLength(4);
    expect(loadConfig({})).toMatchObject({ port: 3001, storage: 'memory', playerClient: 'mock' });
    expect(
      loadConfig({ PORT: '9', STORAGE: 'postgres', PLAYER_CLIENT: 'http', WORLD_CLIENT: 'http', MOCK_PLAYERS: 'a, b,' })
    ).toMatchObject({ port: 9, storage: 'postgres', playerClient: 'http', worldClient: 'http', mockPlayers: ['a', 'b'] });
  });
  it('merges amounts', () => {
    expect(mergeAmounts([{ resourceTypeId: 'b', amount: 1 }, { resourceTypeId: 'a', amount: 2 }, { resourceTypeId: 'b', amount: 3 }])).toEqual([
      { resourceTypeId: 'a', amount: 2 },
      { resourceTypeId: 'b', amount: 4 }
    ]);
  });
});
