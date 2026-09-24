import request from 'supertest';
import { createApp } from '../src/app';
import { MockPlayerClient } from '../src/clients/playerClient';
import { MockWorldClient } from '../src/clients/worldClient';
import { MemoryResourceRepository } from '../src/repositories/memoryResourceRepository';
import { ResourceRepository } from '../src/repositories/resourceRepository';
import { ResourceService } from '../src/services/resourceService';

export async function seedRepo(repo: ResourceRepository) {
  const now = new Date().toISOString();
  for (const id of ['wood', 'metal_scraps', 'paper', 'food']) {
    await repo.createType({ id, name: id, description: '', createdAt: now });
  }
  await repo.setBalance({ playerId: 'player-1', resourceTypeId: 'wood', quantity: 10 });
  await repo.setBalance({ playerId: 'player-1', resourceTypeId: 'metal_scraps', quantity: 5 });
}

export async function makeApp(repo: ResourceRepository = new MemoryResourceRepository()) {
  await seedRepo(repo);
  const svc = new ResourceService(repo, new MockPlayerClient(), new MockWorldClient());
  return { app: createApp(svc), repo, svc, api: () => request(createApp(svc)) };
}
