/** Animated architecture diagram (inline SVG, theme-aware). */
export function ArchitectureDiagram() {
  const box = "fill-[var(--card)] stroke-[var(--border)]";
  const label = "fill-[var(--foreground)] text-[13px] font-semibold";
  const sub = "fill-[var(--muted-foreground)] text-[11px]";
  const flow = "stroke-[var(--primary)] lm-flow";
  return (
    <svg viewBox="0 0 880 330" className="h-auto w-full" role="img" aria-label="Architecture: n8n sends signed events to the Next.js modular monolith, which uses Supabase Postgres, Auth and Realtime and the Gemini API, and calls back n8n for approved recoveries.">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="fill-[var(--primary)]" /></marker>
      </defs>
      <rect x="20" y="110" width="180" height="110" rx="12" className={box} strokeWidth="1.5" />
      <text x="110" y="150" textAnchor="middle" className={label}>n8n (self-hosted)</text>
      <text x="110" y="172" textAnchor="middle" className={sub}>Error Trigger · executor</text>
      <text x="110" y="192" textAnchor="middle" className={sub}>Oracle Cloud · Caddy TLS</text>

      <rect x="320" y="60" width="240" height="210" rx="14" className="fill-[color-mix(in_oklch,var(--primary)_8%,var(--card))] stroke-[var(--primary)]" strokeWidth="1.5" />
      <text x="440" y="92" textAnchor="middle" className={label}>Next.js modular monolith</text>
      {["Route Handlers /api/v1", "Services · policy engine", "AI provider abstraction", "Drizzle repositories"].map((t, i) => (
        <g key={t}>
          <rect x="340" y={108 + i * 38} width="200" height="28" rx="7" className={box} />
          <text x="440" y={127 + i * 38} textAnchor="middle" className={sub}>{t}</text>
        </g>
      ))}

      <rect x="680" y="40" width="180" height="110" rx="12" className={box} strokeWidth="1.5" />
      <text x="770" y="80" textAnchor="middle" className={label}>Supabase</text>
      <text x="770" y="102" textAnchor="middle" className={sub}>Postgres + RLS · Auth</text>
      <text x="770" y="122" textAnchor="middle" className={sub}>Realtime</text>

      <rect x="680" y="190" width="180" height="90" rx="12" className={box} strokeWidth="1.5" />
      <text x="770" y="228" textAnchor="middle" className={label}>Gemini API</text>
      <text x="770" y="250" textAnchor="middle" className={sub}>structured JSON output</text>

      <path d="M200 140 C 260 140, 260 130, 318 130" fill="none" strokeWidth="2" className={flow} markerEnd="url(#arrow)" />
      <text x="258" y="122" textAnchor="middle" className={sub}>signed events</text>
      <path d="M318 210 C 260 210, 260 200, 202 200" fill="none" strokeWidth="2" className={flow} markerEnd="url(#arrow)" />
      <text x="258" y="230" textAnchor="middle" className={sub}>approved recovery</text>
      <path d="M560 120 C 620 120, 620 95, 678 95" fill="none" strokeWidth="2" className={flow} markerEnd="url(#arrow)" />
      <path d="M560 210 C 620 210, 620 235, 678 235" fill="none" strokeWidth="2" className={flow} markerEnd="url(#arrow)" />
      <text x="440" y="300" textAnchor="middle" className={sub}>Vercel · one codebase · no microservices · no Redis until measured need</text>
    </svg>
  );
}
