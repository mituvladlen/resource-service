import { getJson } from './httpJson';

/** Everything Resource Service needs from Player Service. */
export interface PlayerClient {
  playerExists(playerId: string): Promise<boolean>;
}

/** Lab 1 mock: a fixed list of known players. */
export class MockPlayerClient implements PlayerClient {
  private readonly players: Set<string>;
  constructor(players: string[] = ['player-1', 'player-2', 'player-3']) {
    this.players = new Set(players);
  }
  async playerExists(playerId: string): Promise<boolean> {
    return this.players.has(playerId);
  }
}

/** Lab 2: real call to Player Service (GET /players/:id). */
export class HttpPlayerClient implements PlayerClient {
  constructor(private readonly baseUrl: string) {}
  async playerExists(playerId: string): Promise<boolean> {
    const player = await getJson(`${this.baseUrl}/players/${encodeURIComponent(playerId)}`, 'Player Service');
    return player !== null;
  }
}
