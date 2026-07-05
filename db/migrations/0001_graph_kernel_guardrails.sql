-- Graph kernel hard constraints (Agent架构设计.md 决策点 3/4/8/9).
-- These guarantees must hold at the database layer, not just in
-- application code, because the whole product's trust rests on them.
--
-- Note: illegal node_type / edge_type values are already rejected by
-- Postgres' native ENUM types (created in 0000) — no extra CHECK needed.

-- 1. audit_log is truly append-only: no UPDATE, no DELETE, ever.
--    (audit_log.target_id is a loose reference, not a FK, precisely so
--    the historical trail survives even if the underlying node/edge is
--    later removed.)
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

-- 2. provenance content is immutable once written (you can't quietly
--    rewrite "why" an edge exists). DELETE is still allowed so that
--    rejecting a proposed node/edge (which cascades) can clean up —
--    see rule 5/6 below for what may and may not be deleted.
CREATE OR REPLACE FUNCTION prevent_provenance_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'provenance rows are immutable once written';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER provenance_no_update
BEFORE UPDATE ON provenance
FOR EACH ROW EXECUTE FUNCTION prevent_provenance_update();

-- 3. every edge must have an origin. Deferred to end-of-transaction so
--    the application can insert the edge row and its provenance row
--    together and commit once.
CREATE OR REPLACE FUNCTION check_edge_has_provenance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM provenance WHERE edge_id = NEW.id) THEN
    RAISE EXCEPTION 'edge % has no provenance row — every edge must have an origin', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER edges_require_provenance
AFTER INSERT ON edges
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_edge_has_provenance();

-- 4. risk is derived from type, never trusted from the application —
--    defense in depth against the app forgetting to call edgeRiskOf().
CREATE OR REPLACE FUNCTION derive_edge_risk() RETURNS trigger AS $$
BEGIN
  NEW.risk := CASE
    WHEN NEW.type IN ('supports', 'because', 'validates', 'refutes') THEN 'high'::edge_risk
    ELSE 'low'::edge_risk
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER edges_derive_risk
BEFORE INSERT OR UPDATE OF type ON edges
FOR EACH ROW EXECUTE FUNCTION derive_edge_risk();

-- 5. confirmed edges are the trust ledger: identity fields become
--    immutable and the row can never be deleted or un-confirmed.
--    Proposed (not-yet-confirmed) edges may still be freely edited or
--    deleted — that's how AI proposals get rejected without polluting
--    the graph.
CREATE OR REPLACE FUNCTION guard_confirmed_edges() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN
      RAISE EXCEPTION 'confirmed edges cannot be deleted — they are the trust ledger';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'confirmed' THEN
    IF NEW.type IS DISTINCT FROM OLD.type
      OR NEW.src_id IS DISTINCT FROM OLD.src_id
      OR NEW.dst_id IS DISTINCT FROM OLD.dst_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
    THEN
      RAISE EXCEPTION 'confirmed edges are immutable except for status transitions';
    END IF;
    IF NEW.status = 'proposed' THEN
      RAISE EXCEPTION 'a confirmed edge cannot be reverted to proposed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER edges_guard_confirmed
BEFORE UPDATE OR DELETE ON edges
FOR EACH ROW EXECUTE FUNCTION guard_confirmed_edges();

-- 6. same guarantee for nodes: confirmed nodes cannot be deleted, and
--    a node's fundamental type/project can never shapeshift after
--    creation (title/body remain freely editable — that's normal PRD
--    editing).
CREATE OR REPLACE FUNCTION guard_nodes() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN
      RAISE EXCEPTION 'confirmed nodes cannot be deleted — they are the trust ledger';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.type IS DISTINCT FROM OLD.type OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'node type and project_id are immutable after creation';
  END IF;
  IF OLD.status = 'confirmed' AND NEW.status = 'proposed' THEN
    RAISE EXCEPTION 'a confirmed node cannot be reverted to proposed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nodes_guard
BEFORE UPDATE OR DELETE ON nodes
FOR EACH ROW EXECUTE FUNCTION guard_nodes();

-- 7. keep updated_at honest without relying on the app to set it.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nodes_touch_updated_at
BEFORE UPDATE ON nodes
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
