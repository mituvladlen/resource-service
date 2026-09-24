import 'dotenv/config';

export interface Config {
  port: number;
  storage: 'memory' | 'postgres';
  databaseUrl: string;
  playerClient: 'mock' | 'http';
  worldClient: 'mock' | 'http';
  playerServiceUrl: string;
  worldServiceUrl: string;
  mockPlayers: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3001),
    storage: env.STORAGE === 'postgres' ? 'postgres' : 'memory',
    databaseUrl: env.DATABASE_URL ?? '',
    playerClient: env.PLAYER_CLIENT === 'http' ? 'http' : 'mock',
    worldClient: env.WORLD_CLIENT === 'http' ? 'http' : 'mock',
    playerServiceUrl: env.PLAYER_SERVICE_URL ?? 'http://localhost:3000',
    worldServiceUrl: env.WORLD_SERVICE_URL ?? 'http://localhost:3003',
    mockPlayers: (env.MOCK_PLAYERS ?? 'player-1,player-2,player-3,player-4')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  };
}
