-- Resource Service seed. Runs ONLY when the database is empty (no resource types yet).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM resource_types) THEN
    RAISE NOTICE 'resource-service: database already has data, seed skipped';
    RETURN;
  END IF;

  INSERT INTO resource_types (id, name, description) VALUES
    ('wood',         'Wood',         'Planks and broken desks. Used for barricades and upgrades.'),
    ('metal_scraps', 'Metal scraps', 'Bent chair legs, pipes, server rack parts.'),
    ('paper',        'Paper',        'Old exam sheets and lecture notes.'),
    ('food',         'Food',         'Cafeteria leftovers. Kiki likes it too.');

  INSERT INTO player_resources (player_id, resource_type_id, quantity) VALUES
    ('player-1', 'wood', 30), ('player-1', 'metal_scraps', 15), ('player-1', 'paper', 20), ('player-1', 'food', 10),
    ('player-2', 'wood', 20), ('player-2', 'metal_scraps', 10), ('player-2', 'paper', 15), ('player-2', 'food', 15),
    ('player-3', 'wood', 10), ('player-3', 'metal_scraps', 5),  ('player-3', 'paper', 10), ('player-3', 'food', 20);

  INSERT INTO node_resources (node_id, resource_type_id, quantity) VALUES
    ('node-carpentry-workshop', 'wood', 500),
    ('node-robotics-lab', 'metal_scraps', 300),
    ('node-library', 'paper', 800),
    ('node-cafeteria', 'food', 400);

  RAISE NOTICE 'resource-service: seed applied';
END $$;
