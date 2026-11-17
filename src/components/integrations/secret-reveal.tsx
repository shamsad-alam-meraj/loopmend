"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <code className={`min-w-0 flex-1 truncate rounded-md border bg-muted px-2 py-1.5 text-xs ${mono ? "font-mono" : ""}`}>{value}</code>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

export function SecretReveal({ integrationId, webhookSecret, webhookUrl }: { integrationId: string; webhookSecret: string; webhookUrl: string }) {
  return (
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
      <p className="text-xs font-medium">Shown once. Store it as an n8n credential — Loopmend keeps only an encrypted copy.</p>
      <CopyField label="Webhook URL" value={webhookUrl} />
      <CopyField label="x-loopmend-integration" value={integrationId} />
      <CopyField label="Signing secret" value={webhookSecret} />
    </div>
  );
}
