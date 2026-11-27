import { ApiError } from "@/lib/api/http";
import type { Database } from "@/lib/database.types";

/**
 * Hand-rolled request validation (kept dependency-free). The database enforces
 * the same rules via CHECK constraints and triggers; this layer exists to give
 * clear 400s before a round-trip.
 */

export const STATUS_CODES = [
  "scheduled",
  "rescheduled",
  "completed",
  "incomplete",
  "cancelled",
] as const;
export type StatusCode = (typeof STATUS_CODES)[number];

/** Statuses a client may append via POST /statuses ("scheduled" is only set on booking). */
export const SETTABLE_STATUSES = [
  "rescheduled",
  "completed",
  "incomplete",
  "cancelled",
] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

/**
 * Permission required to move a consultation into each status. Mirrors
 * consultation_status_types.required_permission, which RLS enforces.
 */
export const STATUS_PERMISSION = {
  completed: "consultations.complete.own",
  incomplete: "consultations.complete.own",
  rescheduled: "consultations.reschedule.own",
  cancelled: "consultations.cancel.own",
} as const satisfies Record<SettableStatus, Database["public"]["Enums"]["app_permission"]>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requiredString(body: Record<string, unknown>, key: string, max: number) {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, "bad_request", `${key} is required`);
  }
  if (value.trim().length > max) {
    throw new ApiError(400, "bad_request", `${key} must be at most ${max} characters`);
  }
  return value.trim();
}

function futureDatetime(value: unknown, key: string) {
  if (typeof value !== "string") {
    throw new ApiError(400, "bad_request", `${key} is required`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, "bad_request", `${key} must be an ISO 8601 datetime`);
  }
  if (date.getTime() <= Date.now()) {
    throw new ApiError(400, "bad_request", `${key} must be in the future`);
  }
  return date.toISOString();
}

export function parseId(id: string) {
  if (!UUID_RE.test(id)) throw new ApiError(404, "not_found", "Not found");
  return id;
}

export type CreateConsultationInput = {
  firstName: string;
  lastName: string;
  reason: string;
  scheduledAt: string;
};

export function parseCreateConsultation(body: unknown): CreateConsultationInput {
  if (!isObject(body)) throw new ApiError(400, "bad_request", "Body must be a JSON object");
  return {
    firstName: requiredString(body, "firstName", 100),
    lastName: requiredString(body, "lastName", 100),
    reason: requiredString(body, "reason", 1000),
    scheduledAt: futureDatetime(body.scheduledAt, "scheduledAt"),
  };
}

export type CreateStatusInput =
  | { status: "rescheduled"; scheduledAt: string }
  | { status: Exclude<SettableStatus, "rescheduled"> };

export function parseCreateStatus(body: unknown): CreateStatusInput {
  if (!isObject(body)) throw new ApiError(400, "bad_request", "Body must be a JSON object");
  const status = body.status;
  if (typeof status !== "string" || !(SETTABLE_STATUSES as readonly string[]).includes(status)) {
    throw new ApiError(400, "bad_request", `status must be one of: ${SETTABLE_STATUSES.join(", ")}`);
  }
  if (status === "rescheduled") {
    return { status, scheduledAt: futureDatetime(body.scheduledAt, "scheduledAt") };
  }
  return { status: status as Exclude<SettableStatus, "rescheduled"> };
}

export type ListQuery = { status?: StatusCode; limit: number; offset: number };

export function parseListQuery(params: URLSearchParams): ListQuery {
  const status = params.get("status") ?? undefined;
  if (status !== undefined && !(STATUS_CODES as readonly string[]).includes(status)) {
    throw new ApiError(400, "bad_request", `status must be one of: ${STATUS_CODES.join(", ")}`);
  }
  const limit = params.has("limit") ? Number(params.get("limit")) : 50;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, "bad_request", "limit must be an integer between 1 and 100");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ApiError(400, "bad_request", "offset must be a non-negative integer");
  }
  return { status: status as StatusCode | undefined, limit, offset };
}
