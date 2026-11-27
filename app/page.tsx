import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/rbac";

/** Reads the session (request data), so it streams inside a Suspense boundary. */
async function RedirectIfSignedIn() {
  if (await getSession()) redirect("/dashboard");
  return null;
}

export default function Home() {
  return (
    <AppShell>
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
      <section className="flex flex-col items-center gap-6 py-24 text-center">
        <h1 className="text-4xl font-bold">Contour mini-LMS</h1>
        <p className="max-w-md text-muted-foreground">
          Book and manage your consultations in one place.
        </p>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/auth/sign-up">Create an account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/auth/login">Sign in</Link>
          </Button>
        </div>
      </section>
    </AppShell>
  );
}
