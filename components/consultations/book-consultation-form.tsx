"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { consultationsApi } from "@/lib/consultations/client-api";
import { toDatetimeLocalValue } from "./shared";

export function BookConsultationForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    setIsSubmitting(true);
    try {
      await consultationsApi.create({
        firstName: String(data.get("firstName")),
        lastName: String(data.get("lastName")),
        reason: String(data.get("reason")),
        // datetime-local is the user's local time; send an unambiguous UTC instant.
        scheduledAt: new Date(String(data.get("scheduledAt"))).toISOString(),
      });
      form.reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to book consultation");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Book a consultation</CardTitle>
        <CardDescription>Choose a time and tell us what you need help with.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" name="firstName" required maxLength={100} autoComplete="given-name" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" name="lastName" required maxLength={100} autoComplete="family-name" />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="reason">Reason for consultation</Label>
            <Textarea id="reason" name="reason" required maxLength={1000} rows={3} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="scheduledAt">Date and time</Label>
            <Input
              id="scheduledAt"
              name="scheduledAt"
              type="datetime-local"
              required
              min={toDatetimeLocalValue(new Date())}
              suppressHydrationWarning
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? "Booking…" : "Book consultation"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
