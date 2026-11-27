"use client";

import { Fragment } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Consultation } from "@/lib/consultations/service";
import {
  LocalDateTime,
  StatusBadge,
  StatusHistoryPanel,
  StatusHistoryToggle,
  useStatusHistory,
} from "./shared";

const COLUMN_COUNT = 5;

/** Read-only view of every consultation in the system (consultations.read.all). */
export function AllConsultationsTable({ consultations }: { consultations: Consultation[] }) {
  if (consultations.length === 0) {
    return <p className="text-sm text-muted-foreground">No consultations have been booked yet.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Scheduled for</TableHead>
          <TableHead>Student</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>History</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {consultations.map((c) => (
          <ConsultationRow key={c.id} consultation={c} />
        ))}
      </TableBody>
    </Table>
  );
}

/** A consultation row plus a hidden row beneath it that expands to show the status history. */
function ConsultationRow({ consultation: c }: { consultation: Consultation }) {
  const { open, toggle, entries, error } = useStatusHistory(c.id);
  const panelId = `history-${c.id}`;

  return (
    <Fragment>
      <TableRow className={open ? "align-top border-b-0" : "align-top"}>
        <TableCell className="whitespace-nowrap">
          <LocalDateTime iso={c.scheduledAt} />
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {c.firstName} {c.lastName}
        </TableCell>
        <TableCell className="max-w-xs whitespace-pre-wrap">{c.reason}</TableCell>
        <TableCell>
          <StatusBadge status={c.status} label={c.statusLabel} />
        </TableCell>
        <TableCell className="whitespace-nowrap">
          <StatusHistoryToggle open={open} onToggle={toggle} controls={panelId} />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow id={panelId} className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={COLUMN_COUNT} className="px-6 py-3">
            <StatusHistoryPanel entries={entries} error={error} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
