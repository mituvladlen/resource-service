# Resource Service

Owns resource types (wood, metal scraps, paper, food, ...), quantities per player and per world node, where resources were gathered, and applies gather/consume operations **exactly once** using an `actionId` idempotency key.

Part of the FAF zombie-survival game, Team 6. Stack: TypeScript, Node.js 20, Express, PostgreSQL 16.

## Prerequisites

Node.js 20+ and npm, Docker with Docker Compose v2 (for PostgreSQL or the full container stack). Nothing else: tests and the in-memory mode need no database.

## Port

The service listens on **3001** (`PORT`). Its PostgreSQL container is published on **5433** (`POSTGRES_PORT`).

## Environment variables

Copy `.env.example` to `.env` (`run.sh` does it for you). `.env` is gitignored, never commit it.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3001 | HTTP port |
| `STORAGE` | postgres | `postgres` or `memory` |
| `DATABASE_URL` | - | PostgreSQL connection string (required when `STORAGE=postgres`) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | - | Used by `docker-compose.yml` to create the DB |
| `POSTGRES_PORT` | 5433 | Host port of the DB container |
| `PLAYER_CLIENT` / `WORLD_CLIENT` | mock | `mock` (Lab 1) or `http` (Lab 2) |
| `PLAYER_SERVICE_URL` / `WORLD_SERVICE_URL` | localhost:3000 / 3003 | Used when the client is `http` |
| `MOCK_PLAYERS` | player-1,player-2,player-3,player-4 | Players the mock Player Service knows |

## How to run

```bash
./run.sh            # install, build, start (starts the PostgreSQL container first when STORAGE=postgres)
./run.sh --memory   # same, but in-memory storage, no Docker needed
./run.sh --docker   # service + PostgreSQL both in Docker (docker compose up --build)
```

Check it: `curl http://localhost:3001/health`.

On startup the service creates its tables (`db/schema.sql`) and runs the seed (`db/seed.sql`), which only inserts data when the database is empty. You can also run it by hand with `npm run build && npm run seed`.

## Docker

```bash
docker build -t <dockerhub-user>/resource-service:1.0.0 .
docker push <dockerhub-user>/resource-service:1.0.0

# run the public image on a clean machine (in-memory, no DB)
docker run --rm -p 3001:3001 -e STORAGE=memory <dockerhub-user>/resource-service:1.0.0
```

The PostgreSQL data lives in the named volume `resource_pgdata`, so it survives `docker compose down` (use `docker compose down -v` to wipe it).

## Tests

```bash
npm test                 # unit + API tests (in-memory, mocked Player/World/Resource)
npm run test:coverage    # fails under 80% coverage
TEST_DATABASE_URL=postgres://user:pass@localhost:5433/test_db npm test   # also runs the PostgreSQL integration test
```

## Project layout

```
src/
  domain/         types and game rules
  services/       business logic (validation, idempotency, mocks usage)
  repositories/   storage port + in-memory and PostgreSQL implementations
  clients/        Player / World clients: interface + Mock (Lab 1) + Http (Lab 2)
  http/           routes and request validation (zod)
db/               schema.sql, seed.sql
tests/
```

## Communication contract

### Resource Service (port 3001)

Owns resource types, the quantity of every resource per player and per world node, and the ledger of every gather/consume. Game Service decides *when* a gathering action finishes; Resource Service decides *what the player receives* and applies it exactly once.

**Idempotency.** `POST /gather` and `POST /consume` require an `actionId` (any unique string, e.g. a UUID). The first call applies the change and answers `201`. Any later call with the same `actionId` and the same body changes nothing and answers `200` with `"duplicate": true` and the original result. The same `actionId` with a different body answers `409 ACTION_ID_REUSED`. A request that failed (e.g. `422`) does not burn its `actionId`.

**Errors** always look like `{ "error": { "code": "INSUFFICIENT_RESOURCES", "message": "...", "details": {} } }`.

**Data types**

```jsonc
// ResourceType
{ "id": "wood", "name": "Wood", "description": "string", "createdAt": "ISO-8601" }
// Balance (player quantity)
{ "playerId": "player-1", "resourceTypeId": "wood", "quantity": 30 }
// NodeStock (quantity left at a node; a node with no stock row is unlimited)
{ "nodeId": "node-library", "resourceTypeId": "paper", "quantity": 800 }
// Action (ledger entry)
{
  "actionId": "string", "kind": "GATHER | CONSUME", "playerId": "player-1",
  "nodeId": "node-library | null",   // where it was gathered
  "reason": "BARRICADE | BASE_UPGRADE | FACILITY | STORAGE | DECORATION | CRAFT | FEED_KIKI | OTHER | null",
  "items": [{ "resourceTypeId": "paper", "amount": 12 }],
  "balancesAfter": [{ "playerId": "player-1", "resourceTypeId": "paper", "quantity": 32 }],
  "createdAt": "ISO-8601"
}
```

| Method | Path | Request body | Response | Status codes |
|---|---|---|---|---|
| GET | `/health` | - | `{ "status": "ok", "service": "resource-service" }` | 200 |
| GET | `/resource-types` | - | `ResourceType[]` | 200 |
| GET | `/resource-types/:id` | - | `ResourceType` | 200, 404 |
| POST | `/resource-types` | `{ "id": "chemicals", "name": "Chemicals", "description"?: "..." }` | `ResourceType` | 201, 400, 409 |
| PUT | `/resource-types/:id` | `{ "name"?: "...", "description"?: "..." }` | `ResourceType` | 200, 400, 404 |
| DELETE | `/resource-types/:id` | - | empty | 204, 404, 409 (still held) |
| GET | `/players/:playerId/resources` | - | `Balance[]` (all types, 0 if not held) | 200, 404 |
| GET | `/players/:playerId/resources/:resourceTypeId` | - | `Balance` | 200, 404 |
| PUT | `/players/:playerId/resources/:resourceTypeId` | `{ "quantity": 25 }` (admin/debug) | `Balance` | 200, 400, 404 |
| GET | `/nodes/:nodeId/resources` | - | `{ "nodeId", "resourceTypeId", "stocks": NodeStock[] }` | 200, 404 |
| PUT | `/nodes/:nodeId/resources/:resourceTypeId` | `{ "quantity": 500 }` | `NodeStock` | 200, 400, 404 |
| POST | `/gather` | `{ "actionId": "uuid", "playerId": "player-1", "nodeId": "node-cafeteria", "amount": 12, "resourceTypeId"?: "food" }` | `{ "duplicate": false, "action": Action }` | 201, 200 (duplicate), 400, 404 (player/node), 409, 422 (`NODE_DEPLETED`, `RESOURCE_NOT_AT_NODE`) |
| POST | `/consume` | `{ "actionId": "uuid", "playerId": "player-1", "reason": "BARRICADE", "items": [{ "resourceTypeId": "wood", "amount": 5 }] }` | `{ "duplicate": false, "action": Action }` | 201, 200 (duplicate), 400, 404, 409, 422 (`INSUFFICIENT_RESOURCES` with `details.missing[]`) |
| GET | `/actions?playerId=&nodeId=&kind=&limit=` | - | `Action[]`, newest first (limit 1-200, default 50) | 200, 400 |
| GET | `/actions/:actionId` | - | `Action` | 200, 404 |

**Calls to other services** (behind interfaces, mocked in Lab 1): Player Service `GET /players/:id` (player exists), World Service `GET /nodes/:id` → `{ "id", "resourceTypeId" }` (node exists and which resource it yields).
