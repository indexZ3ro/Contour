"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Consultation } from "@/lib/consultations/service";
import { LocalDateTime, StatusBadge, StatusHistory } from "./shared";

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
          <TableRow key={c.id} className="align-top">
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
            <TableCell>
              <StatusHistory consultationId={c.id} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
