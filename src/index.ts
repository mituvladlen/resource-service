import { loadConfig } from './config';
import { createApp } from './app';
import { ResourceService } from './services/resourceService';
import { MemoryResourceRepository } from './repositories/memoryResourceRepository';
import { PostgresResourceRepository } from './repositories/postgresResourceRepository';
import { ResourceRepository } from './repositories/resourceRepository';
import { HttpPlayerClient, MockPlayerClient } from './clients/playerClient';
import { HttpWorldClient, MockWorldClient } from './clients/worldClient';
import { createPool, migrate, seed } from './db/pool';

async function main() {
  const cfg = loadConfig();

  let repo: ResourceRepository;
  if (cfg.storage === 'postgres') {
    const pool = createPool(cfg.databaseUrl);
    await migrate(pool);
    await seed(pool); // no-op when the DB already has data
    repo = new PostgresResourceRepository(pool);
  } else {
    repo = new MemoryResourceRepository();
    // Same starting data as db/seed.sql, so both modes behave identically.
    const mem = repo as MemoryResourceRepository;
    const now = new Date().toISOString();
    for (const [id, name] of [['wood', 'Wood'], ['metal_scraps', 'Metal scraps'], ['paper', 'Paper'], ['food', 'Food']]) {
      await mem.createType({ id, name, description: '', createdAt: now });
    }
    const start: Record<string, number[]> = { 'player-1': [30, 15, 20, 10], 'player-2': [20, 10, 15, 15], 'player-3': [10, 5, 10, 20] };
    for (const [playerId, amounts] of Object.entries(start)) {
      ['wood', 'metal_scraps', 'paper', 'food'].forEach((t, i) => mem.setBalance({ playerId, resourceTypeId: t, quantity: amounts[i] }));
    }
    const nodes: [string, string, number][] = [
      ['node-carpentry-workshop', 'wood', 500], ['node-robotics-lab', 'metal_scraps', 300], ['node-library', 'paper', 800], ['node-cafeteria', 'food', 400]
    ];
    for (const [nodeId, resourceTypeId, quantity] of nodes) await mem.setNodeStock({ nodeId, resourceTypeId, quantity });
  }

  const players = cfg.playerClient === 'http' ? new HttpPlayerClient(cfg.playerServiceUrl) : new MockPlayerClient(cfg.mockPlayers);
  const world = cfg.worldClient === 'http' ? new HttpWorldClient(cfg.worldServiceUrl) : new MockWorldClient();

  const app = createApp(new ResourceService(repo, players, world));
  app.listen(cfg.port, () =>
    console.log(`[resource-service] listening on :${cfg.port} (storage=${cfg.storage}, player=${cfg.playerClient}, world=${cfg.worldClient})`)
  );
}

main().catch((e) => {
  console.error('[resource-service] failed to start:', e);
  process.exit(1);
});
