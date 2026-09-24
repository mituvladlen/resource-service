import { getJson } from './httpJson';

export interface WorldNode {
  id: string;
  resourceTypeId: string; // the resource this node yields
}

/** Everything Resource Service needs from World Service. */
export interface WorldClient {
  getNode(nodeId: string): Promise<WorldNode | null>;
}

export const MOCK_NODES: WorldNode[] = [
  { id: 'node-carpentry-workshop', resourceTypeId: 'wood' },
  { id: 'node-robotics-lab', resourceTypeId: 'metal_scraps' },
  { id: 'node-library', resourceTypeId: 'paper' },
  { id: 'node-cafeteria', resourceTypeId: 'food' }
];

/** Lab 1 mock: a small fixed campus map. */
export class MockWorldClient implements WorldClient {
  private readonly nodes: Map<string, WorldNode>;
  constructor(nodes: WorldNode[] = MOCK_NODES) {
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
  }
  async getNode(nodeId: string): Promise<WorldNode | null> {
    return this.nodes.get(nodeId) ?? null;
  }
}

/** Lab 2: real call to World Service (GET /nodes/:id). */
export class HttpWorldClient implements WorldClient {
  constructor(private readonly baseUrl: string) {}
  async getNode(nodeId: string): Promise<WorldNode | null> {
    return getJson<WorldNode>(`${this.baseUrl}/nodes/${encodeURIComponent(nodeId)}`, 'World Service');
  }
}
