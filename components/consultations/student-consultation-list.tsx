"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { consultationsApi } from "@/lib/consultations/client-api";
import type { Consultation } from "@/lib/consultations/service";
import type { CreateStatusInput } from "@/lib/consultations/validation";
import { LocalDateTime, StatusBadge, StatusHistory, toDatetimeLocalValue } from "./shared";

export function StudentConsultationList({ consultations }: { consultations: Consultation[] }) {
  if (consultations.length === 0) {
    return <p className="text-sm text-muted-foreground">You have no consultations yet.</p>;
  }
  return (
    <ul className="grid gap-3">
      {consultations.map((c) => (
        <li key={c.id}>
          <ConsultationItem consultation={c} />
        </li>
      ))}
    </ul>
  );
}

function ConsultationItem({ consultation: c }: { consultation: Consultation }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

  const isCancelled = c.status === "cancelled";
  const isCompleted = c.status === "completed";

  async function change(input: CreateStatusInput) {
    setError(null);
    setPending(true);
    try {
      await consultationsApi.addStatus(c.id, input);
      setRescheduling(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setPending(false);
    }
  }

  function onReschedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("scheduledAt"));
    change({ status: "rescheduled", scheduledAt: new Date(value).toISOString() });
  }

  return (
    <Card className={isCancelled ? "opacity-70" : undefined}>
      <CardContent className="grid gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">
              <LocalDateTime iso={c.scheduledAt} />
            </p>
            <p className="text-sm text-muted-foreground">
              {c.firstName} {c.lastName}
            </p>
          </div>
          <StatusBadge status={c.status} label={c.statusLabel} />
        </div>
        <p className="whitespace-pre-wrap text-sm">{c.reason}</p>

        {!isCancelled && (
          <div className="flex flex-wrap gap-2">
            {isCompleted ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => change({ status: "incomplete" })}>
                Mark incomplete
              </Button>
            ) : (
              <>
                <Button size="sm" disabled={pending} onClick={() => change({ status: "completed" })}>
                  Mark complete
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setRescheduling((v) => !v)}>
                  Reschedule
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm("Cancel this consultation? This cannot be undone.")) {
                      change({ status: "cancelled" });
                    }
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        )}

        {rescheduling && (
          <form onSubmit={onReschedule} className="flex flex-wrap items-center gap-2">
            <Input
              name="scheduledAt"
              type="datetime-local"
              required
              min={toDatetimeLocalValue(new Date())}
              defaultValue={toDatetimeLocalValue(new Date(c.scheduledAt))}
              className="w-auto"
              aria-label="New date and time"
            />
            <Button size="sm" type="submit" disabled={pending}>
              Save new time
            </Button>
          </form>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <StatusHistory consultationId={c.id} />
      </CardContent>
    </Card>
  );
}
