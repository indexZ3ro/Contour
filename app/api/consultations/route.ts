import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/rbac";
import { readJson, withErrorHandling } from "@/lib/api/http";
import { parseCreateConsultation, parseListQuery } from "@/lib/consultations/validation";
import { createConsultation, listConsultations } from "@/lib/consultations/service";

/**
 * GET /api/consultations?status=&limit=&offset=
 * Lists consultations visible to the caller. One endpoint for every role:
 * RLS scopes students to their own rows; consultations.read.all sees everything.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  await requirePermission(["consultations.read.own", "consultations.read.all"], supabase);

  const query = parseListQuery(request.nextUrl.searchParams);
  const result = await listConsultations(supabase, query);

  return NextResponse.json({ ...result, limit: query.limit, offset: query.offset });
});

/** POST /api/consultations: book a new consultation for the caller. */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  await requirePermission("consultations.create", supabase);

  const input = parseCreateConsultation(await readJson(request));
  const consultation = await createConsultation(supabase, input);

  return NextResponse.json(
    { data: consultation },
    {
      status: 201,
      headers: { Location: `/api/consultations/${consultation.id}` },
    },
  );
});
