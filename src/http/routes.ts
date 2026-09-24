import { NextFunction, Request, Response, Router } from 'express';
import { ZodTypeAny, z } from 'zod';
import { ResourceService } from '../services/resourceService';
import { ActionRecord, ApplyResult } from '../domain/types';
import {
  consumeSchema,
  createTypeSchema,
  gatherSchema,
  listActionsSchema,
  setQuantitySchema,
  updateTypeSchema
} from './validation';

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
/** The fingerprint is an internal idempotency detail: never expose it. */
const publicAction = ({ fingerprint: _f, ...a }: ActionRecord) => a;
const publicResult = (r: ApplyResult) => ({ duplicate: r.duplicate, action: publicAction(r.action) });

const parse = <S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> => schema.parse(data);

export function resourceRoutes(svc: ResourceService): Router {
  const r = Router();

  // Resource types
  r.get('/resource-types', h(async (_req, res) => res.json(await svc.listTypes())));
  r.get('/resource-types/:id', h(async (req, res) => res.json(await svc.getType(req.params.id))));
  r.post('/resource-types', h(async (req, res) => res.status(201).json(await svc.createType(parse(createTypeSchema, req.body)))));
  r.put('/resource-types/:id', h(async (req, res) => res.json(await svc.updateType(req.params.id, parse(updateTypeSchema, req.body)))));
  r.delete('/resource-types/:id', h(async (req, res) => {
    await svc.deleteType(req.params.id);
    res.status(204).end();
  }));

  // Quantities per player
  r.get('/players/:playerId/resources', h(async (req, res) => res.json(await svc.getPlayerResources(req.params.playerId))));
  r.get('/players/:playerId/resources/:resourceTypeId', h(async (req, res) =>
    res.json(await svc.getPlayerResource(req.params.playerId, req.params.resourceTypeId))));
  r.put('/players/:playerId/resources/:resourceTypeId', h(async (req, res) => {
    const { quantity } = parse(setQuantitySchema, req.body);
    res.json(await svc.setPlayerResource(req.params.playerId, req.params.resourceTypeId, quantity));
  }));

  // Quantities per node
  r.get('/nodes/:nodeId/resources', h(async (req, res) => res.json(await svc.getNodeResources(req.params.nodeId))));
  r.put('/nodes/:nodeId/resources/:resourceTypeId', h(async (req, res) => {
    const { quantity } = parse(setQuantitySchema, req.body);
    res.json(await svc.setNodeResource(req.params.nodeId, req.params.resourceTypeId, quantity));
  }));

  // Gather / consume (idempotent by actionId)
  r.post('/gather', h(async (req, res) => {
    const result = await svc.gather(parse(gatherSchema, req.body));
    res.status(result.duplicate ? 200 : 201).json(publicResult(result));
  }));
  r.post('/consume', h(async (req, res) => {
    const result = await svc.consume(parse(consumeSchema, req.body));
    res.status(result.duplicate ? 200 : 201).json(publicResult(result));
  }));

  // Ledger (where/when resources were gathered or spent)
  r.get('/actions', h(async (req, res) => res.json((await svc.listActions(parse(listActionsSchema, req.query))).map(publicAction))));
  r.get('/actions/:actionId', h(async (req, res) => res.json(publicAction(await svc.getAction(req.params.actionId)))));

  return r;
}
