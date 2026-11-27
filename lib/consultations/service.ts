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
 * History rows are written by database triggers, never from here.
 */

type Client = SupabaseClient<Database>;

export type Consultation = {
  id: string;
  studentId: string;
  firstName: string;
  lastName: string;
  reason: string;
  status: StatusCode;
  statusLabel: string;
  scheduledAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ConsultationStatusEntry = {
  id: number;
  status: StatusCode;
  statusLabel: string;
  scheduledAt: string;
  createdAt: string;
  createdBy: string | null;
};

type StatusType = { code: string; label: string };

const CONSULTATION_COLUMNS =
  "id, student_id, first_name, last_name, reason, scheduled_at, created_at, updated_at, consultation_status_types!inner(code, label)";

type ConsultationRow = {
  id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  reason: string;
  scheduled_at: string;
  created_at: string;
  updated_at: string;
  consultation_status_types: StatusType;
};

function toConsultation(row: ConsultationRow): Consultation {
  return {
    id: row.id,
    studentId: row.student_id,
    firstName: row.first_name,
    lastName: row.last_name,
    reason: row.reason,
    status: row.consultation_status_types.code as StatusCode,
    statusLabel: row.consultation_status_types.label,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const HISTORY_COLUMNS =
  "id, scheduled_at, created_at, created_by, consultation_status_types(code, label)";

type HistoryRow = {
  id: number;
  scheduled_at: string;
  created_at: string;
  created_by: string | null;
  consultation_status_types: StatusType;
};

function toStatusEntry(row: HistoryRow): ConsultationStatusEntry {
  return {
    id: row.id,
    status: row.consultation_status_types.code as StatusCode,
    statusLabel: row.consultation_status_types.label,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function listConsultations(supabase: Client, query: ListQuery) {
  let request = supabase
    .from("consultations")
    .select(CONSULTATION_COLUMNS, { count: "exact" })
    .order("scheduled_at", { ascending: true })
    .order("id", { ascending: true })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.status) request = request.eq("consultation_status_types.code", query.status);

  const { data, error, count } = await request;
  if (error) throw fromPostgrestError(error);
  return { data: data.map(toConsultation), total: count ?? 0 };
}

export async function getConsultation(supabase: Client, id: string) {
  const { data, error } = await supabase
    .from("consultations")
    .select(CONSULTATION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (!data) throw new ApiError(404, "not_found", "Consultation not found");
  return toConsultation(data);
}

/** Book: status defaults to 'scheduled'; the history trigger records the booking. */
export async function createConsultation(supabase: Client, input: CreateConsultationInput) {
  const { data, error } = await supabase
    .from("consultations")
    .insert({
      first_name: input.firstName,
      last_name: input.lastName,
      reason: input.reason,
      scheduled_at: input.scheduledAt,
    })
    .select(CONSULTATION_COLUMNS)
    .single();
  if (error) throw fromPostgrestError(error);
  return toConsultation(data);
}

export async function listStatuses(supabase: Client, consultationId: string) {
  // Visibility check first so hidden/non-existent consultations return 404, not [].
  await getConsultation(supabase, consultationId);

  const { data, error } = await supabase
    .from("consultation_status_history")
    .select(HISTORY_COLUMNS)
    .eq("consultation_id", consultationId)
    .order("id", { ascending: true });
  if (error) throw fromPostgrestError(error);
  return data.map(toStatusEntry);
}

/**
 * Changes a consultation's status (and time, for a reschedule). The database
 * enforces the transition rules and per-status permission, and the history
 * trigger records the change. Returns the created history entry.
 */
export async function addStatus(supabase: Client, consultationId: string, input: CreateStatusInput) {
  const { data: statusType, error: typeError } = await supabase
    .from("consultation_status_types")
    .select("id")
    .eq("code", input.status)
    .single();
  if (typeError) throw fromPostgrestError(typeError);

  const { data: updated, error } = await supabase
    .from("consultations")
    .update({
      status_type_id: statusType.id,
      ...(input.status === "rescheduled" && { scheduled_at: input.scheduledAt }),
    })
    .eq("id", consultationId)
    .select("id")
    .maybeSingle();
  if (error) throw fromPostgrestError(error);
  // No row: it doesn't exist or isn't the caller's (RLS). 404 avoids leaking existence.
  if (!updated) throw new ApiError(404, "not_found", "Consultation not found");

  const { data: entry, error: historyError } = await supabase
    .from("consultation_status_history")
    .select(HISTORY_COLUMNS)
    .eq("consultation_id", consultationId)
    .order("id", { ascending: false })
    .limit(1)
    .single();
  if (historyError) throw fromPostgrestError(historyError);
  return toStatusEntry(entry);
}
