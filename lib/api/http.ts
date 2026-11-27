import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

export type ApiErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "internal_error";

export type ApiErrorBody = { error: { code: ApiErrorCode; message: string } };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Translate Postgres / PostgREST errors into API errors without leaking internals. */
export function fromPostgrestError(error: PostgrestError): ApiError {
  switch (error.code) {
    case "CT400": // custom: invalid input raised by our triggers/functions
    case "23514": // check_violation
    case "22P02": // invalid_text_representation (e.g. bad uuid)
    case "22007": // invalid_datetime_format
      return new ApiError(400, "bad_request", error.code.startsWith("CT") ? error.message : "Invalid input");
    case "CT409": // custom: invalid status transition
      return new ApiError(409, "conflict", error.message);
    case "42501": // insufficient_privilege / RLS violation
      return new ApiError(403, "forbidden", "You do not have permission to do this");
    case "PGRST116": // .single() found no row (or row hidden by RLS)
      return new ApiError(404, "not_found", "Not found");
    default:
      console.error("Unhandled database error", error);
      return new ApiError(500, "internal_error", "Something went wrong");
  }
}

export function errorResponse(err: unknown) {
  const apiError =
    err instanceof ApiError
      ? err
      : (console.error("Unhandled API error", err),
        new ApiError(500, "internal_error", "Something went wrong"));
  return NextResponse.json<ApiErrorBody>(
    { error: { code: apiError.code, message: apiError.message } },
    { status: apiError.status },
  );
}

/** Wrap a route handler so any thrown ApiError becomes a JSON error response. */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "bad_request", "Request body must be valid JSON");
  }
}
