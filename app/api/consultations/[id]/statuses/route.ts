import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertPermission, requirePermission, requireSession } from "@/lib/auth/rbac";
import { readJson, withErrorHandling } from "@/lib/api/http";
import { parseCreateStatus, parseId, STATUS_PERMISSION } from "@/lib/consultations/validation";
import { addStatus, listStatuses } from "@/lib/consultations/service";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/consultations/{id}/statuses: full, ordered status history (audit trail). */
export const GET = withErrorHandling(async (_request: NextRequest, { params }: Ctx) => {
  const supabase = await createClient();
  await requirePermission(["consultations.read.own", "consultations.read.all"], supabase);

  const id = parseId((await params).id);
  return NextResponse.json({ data: await listStatuses(supabase, id) });
});

/**
 * POST /api/consultations/{id}/statuses
 * Changes the consultation's status: complete, mark incomplete, cancel, or reschedule.
 *   { "status": "completed" | "incomplete" | "cancelled" }
 *   { "status": "rescheduled", "scheduledAt": "<ISO 8601>" }
 * Each status needs its own permission (complete / reschedule / cancel).
 * Returns 201 with the created history entry, or 409 on an invalid transition.
 */
export const POST = withErrorHandling(async (request: NextRequest, { params }: Ctx) => {
  const supabase = await createClient();
  const session = await requireSession(supabase);

  const id = parseId((await params).id);
  const input = parseCreateStatus(await readJson(request));
  assertPermission(session, STATUS_PERMISSION[input.status]);

  const entry = await addStatus(supabase, id, input);

  return NextResponse.json(
    { data: entry },
    { status: 201, headers: { Location: `/api/consultations/${id}/statuses` } },
  );
});
