/**
 * Browser-side wrappers for the consultations REST API.
 * Mutations always go through the API (never directly to Supabase from the browser),
 * so validation, permission checks and error mapping live in one place.
 */
import type { Consultation, ConsultationStatusEntry } from "./service";
import type { CreateConsultationInput, CreateStatusInput } from "./validation";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return body.data as T;
}

export const consultationsApi = {
  create: (input: CreateConsultationInput) =>
    request<Consultation>("/api/consultations", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  addStatus: (id: string, input: CreateStatusInput) =>
    request<ConsultationStatusEntry>(`/api/consultations/${id}/statuses`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  history: (id: string) =>
    request<ConsultationStatusEntry[]>(`/api/consultations/${id}/statuses`),
};
