import {
  ActionRecord,
  ApplyResult,
  Balance,
  ConsumeCommand,
  GatherCommand,
  NodeStock,
  ResourceType
} from '../domain/types';

export interface ActionFilter {
  playerId?: string;
  kind?: 'GATHER' | 'CONSUME';
  nodeId?: string;
  limit: number;
}

/**
 * Storage port. applyGather/applyConsume MUST be atomic and MUST return
 * { duplicate: true } without changing anything when the actionId was already applied.
 */
export interface ResourceRepository {
  listTypes(): Promise<ResourceType[]>;
  getType(id: string): Promise<ResourceType | null>;
  createType(type: ResourceType): Promise<ResourceType>; // throws 409 if id exists
  updateType(id: string, patch: { name?: string; description?: string }): Promise<ResourceType | null>;
  deleteType(id: string): Promise<boolean>; // throws 409 if still referenced

  getBalances(playerId: string): Promise<Balance[]>;
  setBalance(balance: Balance): Promise<Balance>;

  getNodeStocks(nodeId: string): Promise<NodeStock[]>;
  setNodeStock(stock: NodeStock): Promise<NodeStock>;

  getAction(actionId: string): Promise<ActionRecord | null>;
  listActions(filter: ActionFilter): Promise<ActionRecord[]>;

  applyGather(cmd: GatherCommand): Promise<ApplyResult>;
  applyConsume(cmd: ConsumeCommand): Promise<ApplyResult>;
}
