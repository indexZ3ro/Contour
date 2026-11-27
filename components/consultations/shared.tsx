"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { consultationsApi } from "@/lib/consultations/client-api";
import type { ConsultationStatusEntry } from "@/lib/consultations/service";
import type { StatusCode } from "@/lib/consultations/validation";

const STATUS_VARIANT: Record<StatusCode, "default" | "secondary" | "destructive" | "outline"> = {
  scheduled: "default",
  rescheduled: "default",
  completed: "secondary",
  incomplete: "outline",
  cancelled: "destructive",
};

export function StatusBadge({ status, label }: { status: StatusCode; label: string }) {
  return <Badge variant={STATUS_VARIANT[status]}>{label}</Badge>;
}

/** Renders in the viewer's local timezone (values are stored as UTC). */
export function LocalDateTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}

/** Converts a Date to the value format expected by <input type="datetime-local">. */
export function toDatetimeLocalValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** Lazily loads and shows the audit trail for one consultation. */
export function StatusHistory({ consultationId }: { consultationId: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ConsultationStatusEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setError(null);
      try {
        setEntries(await consultationsApi.history(consultationId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load history");
      }
    }
  }

  return (
    <div className="text-sm">
      <Button variant="link" size="sm" className="h-auto p-0" onClick={toggle}>
        {open ? "Hide history" : "Show history"}
      </Button>
      {open && (
        <div className="mt-2">
          {error && <p className="text-destructive">{error}</p>}
          {!error && !entries && <p className="text-muted-foreground">Loading…</p>}
          {entries && (
            <ol className="space-y-1 border-l pl-4">
              {entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={e.status} label={e.statusLabel} />
                  <span className="text-muted-foreground">
                    set <LocalDateTime iso={e.createdAt} /> · for <LocalDateTime iso={e.scheduledAt} />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
