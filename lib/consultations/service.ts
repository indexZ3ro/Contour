import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ApiError, fromPostgrestError } from "@/lib/api/http";
import type {
  CreateConsultationInput,
  CreateStatusInput,
  ListQuery,
  StatusCode,
} from "./validation";

/**
 * Data-access layer shared by the API route handlers and server components.
 * Always called with a user-scoped Supabase client so RLS decides visibility:
 * students only ever see their own rows, admins (consultations.read.all) see all.
 */

type Client = SupabaseClient<Database>;
type CurrentRow = Database["public"]["Views"]["consultation_current"]["Row"];

export type Consultation = {
  id: string;
  studentId: string;
  firstName: string;
  lastName: string;
  reason: string;
  status: StatusCode;
  statusLabel: string;
  scheduledAt: string;
  statusSetAt: string;
  createdAt: string;
};

export type ConsultationStatusEntry = {
  id: number;
  status: StatusCode;
  statusLabel: string;
  scheduledAt: string;
  createdAt: string;
  createdBy: string | null;
};

const CURRENT_COLUMNS =
  "id, student_id, first_name, last_name, reason, status, status_label, scheduled_at, status_set_at, created_at";

function toConsultation(row: CurrentRow): Consultation {
  // View columns are typed nullable by the generator; the view's inner joins guarantee them.
  return {
    id: row.id!,
    studentId: row.student_id!,
    firstName: row.first_name!,
    lastName: row.last_name!,
    reason: row.reason!,
    status: row.status as StatusCode,
    statusLabel: row.status_label!,
    scheduledAt: row.scheduled_at!,
    statusSetAt: row.status_set_at!,
    createdAt: row.created_at!,
  };
}

export async function listConsultations(supabase: Client, query: ListQuery) {
  let request = supabase
    .from("consultation_current")
    .select(CURRENT_COLUMNS, { count: "exact" })
    .order("scheduled_at", { ascending: true })
    .order("id", { ascending: true })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.status) request = request.eq("status", query.status);

  const { data, error, count } = await request;
  if (error) throw fromPostgrestError(error);
  return { data: data.map(toConsultation), total: count ?? 0 };
}

export async function getConsultation(supabase: Client, id: string) {
  const { data, error } = await supabase
    .from("consultation_current")
    .select(CURRENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (!data) throw new ApiError(404, "not_found", "Consultation not found");
  return toConsultation(data);
}

export async function createConsultation(supabase: Client, input: CreateConsultationInput) {
  const { data: id, error } = await supabase.rpc("book_consultation", {
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_reason: input.reason,
    p_scheduled_at: input.scheduledAt,
  });
  if (error) throw fromPostgrestError(error);
  return getConsultation(supabase, id);
}

const STATUS_COLUMNS =
  "id, scheduled_at, created_at, created_by, consultation_status_types(code, label)";

type StatusRow = {
  id: number;
  scheduled_at: string;
  created_at: string;
  created_by: string | null;
  consultation_status_types: { code: string; label: string };
};

function toStatusEntry(row: StatusRow): ConsultationStatusEntry {
  return {
    id: row.id,
    status: row.consultation_status_types.code as StatusCode,
    statusLabel: row.consultation_status_types.label,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function listStatuses(supabase: Client, consultationId: string) {
  // Visibility check first so hidden/non-existent consultations return 404, not [].
  await getConsultation(supabase, consultationId);

  const { data, error } = await supabase
    .from("consultation_statuses")
    .select(STATUS_COLUMNS)
    .eq("consultation_id", consultationId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw fromPostgrestError(error);
  return data.map(toStatusEntry);
}

/** Appends a status change and returns the created history entry. */
export async function addStatus(supabase: Client, consultationId: string, input: CreateStatusInput) {
  // 404 for consultations the caller cannot see (avoids leaking existence).
  await getConsultation(supabase, consultationId);

  const { data: statusId, error } = await supabase.rpc("set_consultation_status", {
    p_consultation_id: consultationId,
    p_status: input.status,
    p_scheduled_at: input.status === "rescheduled" ? input.scheduledAt : undefined,
  });
  if (error) throw fromPostgrestError(error);

  const { data, error: readError } = await supabase
    .from("consultation_statuses")
    .select(STATUS_COLUMNS)
    .eq("id", statusId)
    .single();
  if (readError) throw fromPostgrestError(readError);
  return toStatusEntry(data);
}
