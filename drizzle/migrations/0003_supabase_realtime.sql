-- Supabase Realtime: publish incident and recovery changes (RLS still applies to subscribers).
-- No-op on plain Postgres / PGlite where the supabase_realtime publication does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'incidents') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'recovery_plans') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.recovery_plans';
    END IF;
  END IF;
END $$;
