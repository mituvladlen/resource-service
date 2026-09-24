-- Resource Service schema (idempotent: safe to run on every start)
CREATE TABLE IF NOT EXISTS resource_types (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Quantities per player
CREATE TABLE IF NOT EXISTS player_resources (
  player_id        TEXT NOT NULL,
  resource_type_id TEXT NOT NULL REFERENCES resource_types(id) ON DELETE RESTRICT,
  quantity         INTEGER NOT NULL CHECK (quantity >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, resource_type_id)
);

-- Quantities still available at a world node (no row = unlimited)
CREATE TABLE IF NOT EXISTS node_resources (
  node_id          TEXT NOT NULL,
  resource_type_id TEXT NOT NULL REFERENCES resource_types(id) ON DELETE RESTRICT,
  quantity         INTEGER NOT NULL CHECK (quantity >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, resource_type_id)
);

-- Ledger of applied gather/consume actions. PRIMARY KEY(action_id) = idempotency key.
CREATE TABLE IF NOT EXISTS resource_actions (
  action_id      TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('GATHER', 'CONSUME')),
  player_id      TEXT NOT NULL,
  node_id        TEXT,
  reason         TEXT,
  items          JSONB NOT NULL,
  balances_after JSONB NOT NULL DEFAULT '[]'::jsonb,
  fingerprint    TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resource_actions_player ON resource_actions (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_actions_node ON resource_actions (node_id) WHERE node_id IS NOT NULL;
