import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { AllConsultationsTable } from "@/components/consultations/all-consultations-table";
import { BookConsultationForm } from "@/components/consultations/book-consultation-form";
import { StudentConsultationList } from "@/components/consultations/student-consultation-list";
import { getSession, hasPermission } from "@/lib/auth/rbac";
import { createClient } from "@/lib/supabase/server";
import { listConsultations } from "@/lib/consultations/service";

const PAGE_SIZE = 20;

/**
 * Role-aware dashboard. The view is chosen from the caller's permissions;
 * the data comes from the same service as GET /api/consultations, and RLS
 * determines which rows are visible.
 */
type Props = { searchParams: Promise<{ page?: string }> };

export default function DashboardPage({ searchParams }: Props) {
  // Request-time data (cookies, searchParams) streams in behind a fallback (cacheComponents).
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading consultations…</p>}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: Props) {
  const supabase = await createClient();
  const session = await getSession(supabase);
  if (!session) redirect("/auth/login");

  const canReadAll = hasPermission(session, "consultations.read.all");
  const canReadOwn = hasPermission(session, "consultations.read.own");
  const canBook = hasPermission(session, "consultations.create");

  if (!canReadAll && !canReadOwn) {
    return <p className="text-sm text-muted-foreground">Your account has no role assigned yet.</p>;
  }

  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const { data, total } = await listConsultations(supabase, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="grid gap-8">
      <header>
        <h1 className="text-2xl font-semibold">
          {canReadAll ? "All consultations" : "My consultations"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {canReadAll
            ? `Read-only view of every consultation in the system (${total} total).`
            : "Book, reschedule, cancel and track your consultations."}
        </p>
      </header>

      {canBook && <BookConsultationForm />}

      <section className="grid gap-4">
        {canReadAll ? (
          <AllConsultationsTable consultations={data} />
        ) : (
          <StudentConsultationList consultations={data} />
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-between text-sm">
            <Button asChild variant="outline" size="sm" className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
              <Link href={`?page=${page - 1}`} aria-disabled={page <= 1}>Previous</Link>
            </Button>
            <span className="text-muted-foreground">
              Page {page} of {pageCount}
            </span>
            <Button asChild variant="outline" size="sm" className={page >= pageCount ? "pointer-events-none opacity-50" : ""}>
              <Link href={`?page=${page + 1}`} aria-disabled={page >= pageCount}>Next</Link>
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
