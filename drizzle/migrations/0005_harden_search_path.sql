-- Harden the SECURITY DEFINER membership check: resolve objects from pg_catalog
-- and public only, with pg_temp last so temporary tables can never shadow them.
CREATE OR REPLACE FUNCTION public.lm_is_member(org uuid, min_role text DEFAULT 'viewer') RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.organization_id = org
      AND m.user_id = auth.uid()
      AND (CASE m.role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'operator' THEN 2 ELSE 1 END)
          >= (CASE min_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'operator' THEN 2 ELSE 1 END)
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lm_is_member(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.lm_is_member(uuid, text) TO authenticated;
