import { formatDateTime, formatRelative, titleCase } from "@/lib/utils/format";

type Event = { id: string; eventType: string; actorType: string; actorEmail: string | null; metadata: Record<string, unknown>; createdAt: Date };

function describe(e: Event): string {
  const m = e.metadata;
  switch (e.eventType) {
    case "created":
      return `Incident opened from event ${m.eventId ?? ""}`;
    case "recurred":
      return `Failure recurred (occurrence #${m.occurrence}) — execution ${m.externalExecutionId ?? ""}`;
    case "status_changed":
      return `Status ${titleCase(String(m.from))} → ${titleCase(String(m.to))}${m.reason ? ` · ${m.reason}` : ""}`;
    case "severity_changed":
      return `Severity ${m.from} → ${m.to}`;
    default:
      return titleCase(e.eventType);
  }
}

type Collapsed = { id: string; collapsed: number; from: Date; to: Date };

/** Newest first; runs of more than 3 consecutive recurrences are collapsed into one summary row. */
function compact(events: Event[]): (Event | Collapsed)[] {
  const out: (Event | Collapsed)[] = [];
  const reversed = [...events].reverse();
  for (let i = 0; i < reversed.length; i++) {
    const e = reversed[i];
    if (e.eventType !== "recurred") {
      out.push(e);
      continue;
    }
    let j = i;
    while (j < reversed.length && reversed[j].eventType === "recurred") j++;
    const run = reversed.slice(i, j);
    if (run.length > 3) {
      out.push(...run.slice(0, 2), { id: `${run[2].id}-collapsed`, collapsed: run.length - 3, from: run.at(-2)!.createdAt, to: run[2].createdAt }, run.at(-1)!);
    } else out.push(...run);
    i = j - 1;
  }
  return out;
}

export function Timeline({ events }: { events: Event[] }) {
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {compact(events).map((e) =>
        "collapsed" in e ? (
          <li key={e.id} className="relative text-xs text-muted-foreground">
            <span className="absolute -left-[23px] top-1 size-1.5 rounded-full bg-muted-foreground" />
            … {e.collapsed} more recurrences between {formatRelative(e.from)} and {formatRelative(e.to)}
          </li>
        ) : (
        <li key={e.id} className="relative">
          <span className="absolute -left-[25px] top-1 size-2.5 rounded-full border-2 border-card bg-primary" />
          <div className="text-sm">{describe(e)}</div>
          {typeof e.metadata.note === "string" && e.metadata.note && <div className="mt-1 rounded-md bg-muted px-2 py-1 text-xs">“{e.metadata.note}”</div>}
          <div className="mt-0.5 text-[11px] text-muted-foreground" title={formatDateTime(e.createdAt)}>
            {e.actorType === "user" ? (e.actorEmail ?? "user") : e.actorType} · {formatRelative(e.createdAt)}
          </div>
        </li>
        ),
      )}
    </ol>
  );
}
