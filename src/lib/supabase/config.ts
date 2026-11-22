/** Public Supabase config (safe for client bundles — anon key only). */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
/** New-style publishable key (sb_publishable_…) or the legacy anon JWT. Both are safe for browsers; RLS protects data. */
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
