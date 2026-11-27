"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { consultationsApi } from "@/lib/consultations/client-api";
import { toDatetimeLocalValue } from "./shared";

/**
 * Renders the page heading with a "Book consultation" button aligned to its right;
 * the booking form expands below the heading row when the button is clicked.
 */
export function BookConsultationForm({
  heading,
}: {
  heading: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function close() {
    setOpen(false);
    setError(null);
  }

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
      close();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to book consultation");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {heading}
        {!open && (
          <Button
            onClick={() => setOpen(true)}
            aria-expanded={false}
            aria-controls="book-consultation"
          >
            Book consultation
          </Button>
        )}
      </div>
      {open && (
        <Card id="book-consultation">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="grid gap-1.5">
              <CardTitle>Book a consultation</CardTitle>
              <CardDescription>
                Choose a time and tell us what you need help with.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={close}
              disabled={isSubmitting}
            >
              Close
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  name="firstName"
                  required
                  maxLength={100}
                  autoComplete="given-name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  name="lastName"
                  required
                  maxLength={100}
                  autoComplete="family-name"
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="reason">Reason for consultation</Label>
                <Textarea
                  id="reason"
                  name="reason"
                  required
                  maxLength={1000}
                  rows={3}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="scheduledAt">Date and time (your local time)</Label>
                <Input
                  id="scheduledAt"
                  name="scheduledAt"
                  type="datetime-local"
                  required
                  min={toDatetimeLocalValue(new Date())}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full sm:w-auto"
                >
                  {isSubmitting ? "Booking…" : "Book consultation"}
                </Button>
              </div>
              {error && (
                <p className="text-sm text-destructive sm:col-span-2">
                  {error}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
