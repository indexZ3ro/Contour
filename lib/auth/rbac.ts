import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { ApiError } from "@/lib/api/http";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type AppPermission = Database["public"]["Enums"]["app_permission"];

/**
 * Mirror of public.role_permissions, used for API fast-fail and UI decisions.
 * The database (RLS via public.authorize) remains the source of truth: even if
 * this map drifted, Postgres would still refuse the operation.
 */
const ROLE_PERMISSIONS: Record<AppRole, readonly AppPermission[]> = {
  student: [
    "consultations.create",
    "consultations.read.own",
    "consultations.update.own",
  ],
  admin: ["consultations.read.all"],
};

export type Session = {
  userId: string;
  email: string | undefined;
  role: AppRole | null;
  permissions: readonly AppPermission[];
};

export function hasPermission(session: Session, permission: AppPermission) {
  return session.permissions.includes(permission);
}

/**
 * Reads the verified JWT claims (getClaims validates the signature) and
 * resolves the role embedded by the custom access token hook.
 */
export async function getSession(
  supabase?: Awaited<ReturnType<typeof createClient>>,
): Promise<Session | null> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  const claims = data.claims;
  const rawRole = claims.user_role;
  const role: AppRole | null =
    rawRole === "student" || rawRole === "admin" ? rawRole : null;

  return {
    userId: claims.sub,
    email: claims.email,
    role,
    permissions: role ? ROLE_PERMISSIONS[role] : [],
  };
}

/**
 * Route-handler guard. Throws ApiError(401) when unauthenticated and
 * ApiError(403) unless the session holds at least one of `anyOf`.
 */
export async function requirePermission(
  anyOf: AppPermission | readonly AppPermission[],
  supabase?: Awaited<ReturnType<typeof createClient>>,
): Promise<Session> {
  const session = await getSession(supabase);
  if (!session) throw new ApiError(401, "unauthenticated", "Sign in required");

  const required = Array.isArray(anyOf) ? anyOf : [anyOf];
  if (!required.some((p) => hasPermission(session, p))) {
    throw new ApiError(403, "forbidden", "You do not have permission to do this");
  }
  return session;
}
