-- Append-only audit log: block UPDATE and DELETE (TRUNCATE is superuser-only by default).
CREATE OR REPLACE FUNCTION lm_prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% blocked)', TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION lm_prevent_audit_mutation();
--> statement-breakpoint
-- Approvals and recovery attempts are also immutable once recorded (attempts may only move out of 'started').
CREATE OR REPLACE FUNCTION lm_prevent_approval_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'approvals are immutable (% blocked)', TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS approvals_immutable ON approvals;
--> statement-breakpoint
CREATE TRIGGER approvals_immutable BEFORE UPDATE OR DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION lm_prevent_approval_mutation();
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Row Level Security.
-- RLS is enabled on every tenant-owned table. The server connects with a
-- privileged role (bypasses RLS) and enforces authorization in services; RLS
-- protects every path that uses the Supabase anon/authenticated key
-- (Realtime subscriptions, direct client queries).
-- Policies reference auth.uid(), which exists on Supabase. On plain Postgres /
-- PGlite we create an equivalent shim so policies can be tested.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    EXECUTE 'CREATE SCHEMA auth';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    EXECUTE $f$
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid'
    $f$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'CREATE ROLE authenticated NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'CREATE ROLE anon NOLOGIN';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.lm_is_member(org uuid, min_role text DEFAULT 'viewer') RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = org
      AND m.user_id = auth.uid()
      AND (CASE m.role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'operator' THEN 2 ELSE 1 END)
          >= (CASE min_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'operator' THEN 2 ELSE 1 END)
  );
$$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'integrations','workflows','workflow_versions','executions','ingested_events',
    'incidents','incident_events','ai_investigations','recovery_plans','approvals',
    'recovery_attempts','audit_logs'
  ];
BEGIN
  -- organizations / memberships / profiles
  EXECUTE 'ALTER TABLE organizations ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_member_read ON organizations';
  EXECUTE 'CREATE POLICY org_member_read ON organizations FOR SELECT TO authenticated USING (public.lm_is_member(id))';

  EXECUTE 'ALTER TABLE memberships ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS membership_read ON memberships';
  EXECUTE 'CREATE POLICY membership_read ON memberships FOR SELECT TO authenticated USING (public.lm_is_member(organization_id))';

  EXECUTE 'ALTER TABLE profiles ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS profile_self ON profiles';
  EXECUTE 'CREATE POLICY profile_self ON profiles FOR SELECT TO authenticated USING (id = auth.uid())';

  EXECUTE 'ALTER TABLE webhook_nonces ENABLE ROW LEVEL SECURITY'; -- server-only table, no policies

  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_read ON %I', t);
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT TO authenticated USING (public.lm_is_member(organization_id))', t);
  END LOOP;

  -- Credentials are never readable from the client, even by members.
  EXECUTE 'DROP POLICY IF EXISTS tenant_read ON integrations';
  EXECUTE 'CREATE POLICY tenant_read ON integrations FOR SELECT TO authenticated USING (public.lm_is_member(organization_id, ''admin''))';

  -- Read-only for client roles: all writes go through the server (service layer + audit).
  EXECUTE 'GRANT USAGE ON SCHEMA public TO authenticated, anon';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated';
  EXECUTE 'REVOKE SELECT ON integrations FROM authenticated';
  EXECUTE 'GRANT SELECT (id, organization_id, type, name, base_url, secret_hint, status, last_verified_at, created_at, updated_at) ON integrations TO authenticated';
  EXECUTE 'REVOKE ALL ON webhook_nonces FROM authenticated, anon';
END $$;
