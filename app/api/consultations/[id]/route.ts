import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/rbac";
import { withErrorHandling } from "@/lib/api/http";
import { parseId } from "@/lib/consultations/validation";
import { getConsultation } from "@/lib/consultations/service";

/** GET /api/consultations/{id}: a single consultation with its current status. */
export const GET = withErrorHandling(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const supabase = await createClient();
    await requirePermission(["consultations.read.own", "consultations.read.all"], supabase);

    const id = parseId((await params).id);
    return NextResponse.json({ data: await getConsultation(supabase, id) });
  },
);
