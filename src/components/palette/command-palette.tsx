"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search, Siren, Workflow as WorkflowIcon, Moon, ExternalLink } from "lucide-react";
import { NAV } from "@/components/dashboard/nav";
import { cn } from "@/lib/utils/cn";

type Item = { id: string; group: string; label: string; hint?: string; icon: React.ComponentType<{ className?: string }>; run: () => void };

/** ⌘K / Ctrl+K palette: navigation, incident search (server-side, tenant-scoped), workflows, actions. */
export function CommandPalette({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [incidents, setIncidents] = useState<{ id: string; number: number; workflowName: string; status: string; errorMessage: string | null }[]>([]);
  const [workflows, setWorkflows] = useState<{ id: string; name: string; health: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !open && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("lm:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("lm:open-palette", onOpen);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 10);
    if (workflows.length === 0) {
      fetch("/api/v1/workflows").then((r) => r.json()).then((j) => j.success && setWorkflows(j.data)).catch(() => {});
    }
  }, [open, workflows.length]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ view: query ? "all" : "active", limit: "8", ...(query ? { q: query } : {}) });
      fetch(`/api/v1/incidents?${qs}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((j) => j.success && setIncidents(j.data))
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, open]);

  const items = useMemo<Item[]>(() => {
    const q = query.toLowerCase().trim();
    const go = (href: string) => () => {
      router.push(href);
      close();
    };
    const nav: Item[] = NAV.map((n) => ({ id: `nav-${n.href}`, group: "Go to", label: n.label, icon: n.icon, run: go(n.href) }));
    const actions: Item[] = [
      { id: "act-theme", group: "Actions", label: "Toggle theme", icon: Moon, run: () => { const next = !document.documentElement.classList.contains("dark"); document.documentElement.classList.toggle("dark", next); try { localStorage.setItem("lm-theme", next ? "dark" : "light"); } catch {} close(); } },
      { id: "act-status", group: "Actions", label: "Open public status page", icon: ExternalLink, run: () => { window.open(`/status/${orgSlug}`, "_blank"); close(); } },
      { id: "act-sim", group: "Actions", label: "Simulate a failure", hint: "Overview", icon: Siren, run: go("/overview#simulator") },
    ];
    const wf: Item[] = workflows.map((w) => ({ id: `wf-${w.id}`, group: "Workflows", label: w.name, hint: w.health, icon: WorkflowIcon, run: go(`/workflows/${w.id}`) }));
    const inc: Item[] = incidents.map((i) => ({ id: `inc-${i.id}`, group: query ? "Incidents" : "Active incidents", label: `INC-${String(i.number).padStart(4, "0")} · ${i.workflowName}`, hint: i.status.replace("_", " "), icon: Siren, run: go(`/incidents/${i.id}`) }));
    const match = (it: Item) => !q || it.label.toLowerCase().includes(q) || it.group.toLowerCase().includes(q);
    return [...inc, ...nav.filter(match), ...wf.filter(match).slice(0, 6), ...actions.filter(match)];
  }, [query, incidents, workflows, router, close, orgSlug]);

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={close} role="presentation">
      <div className="animate-in w-full max-w-xl overflow-hidden rounded-xl border bg-card shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === "Enter") items[active]?.run();
            }}
            placeholder="Search incidents (INC-12, “429”), workflows, pages…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search"
          />
          <kbd className="rounded border px-1.5 text-[10px] text-muted-foreground">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
          {items.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">No results</li>}
          {items.map((it, idx) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id}>
                {header && <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{header}</div>}
                <button
                  role="option"
                  aria-selected={idx === active}
                  onMouseEnter={() => setActive(idx)}
                  onClick={it.run}
                  className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm", idx === active ? "bg-accent text-accent-foreground" : "")}
                >
                  <it.icon className="size-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="text-[11px] capitalize text-muted-foreground">{it.hint}</span>}
                  {idx === active && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-4 border-t px-4 py-2 text-[10px] text-muted-foreground"><span>↑↓ navigate</span><span>↵ open</span><span>⌘K / Ctrl+K or / to toggle</span></div>
      </div>
    </div>
  );
}

export function PaletteTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("lm:open-palette"))}
      className="mb-3 flex w-full items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <Search className="size-3.5" /> <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border px-1 text-[10px]">⌘K</kbd>
    </button>
  );
}
