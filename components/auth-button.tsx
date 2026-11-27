import Link from "next/link";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { getSession } from "@/lib/auth/rbac";
import { LogoutButton } from "./logout-button";

export async function AuthButton() {
  const session = await getSession();

  return session ? (
    <div className="flex items-center gap-3">
      <span className="hidden sm:inline">{session.email}</span>
      {session.role && <Badge variant="outline" className="capitalize">{session.role}</Badge>}
      <LogoutButton />
    </div>
  ) : (
    <div className="flex gap-2">
      <Button asChild size="sm" variant={"outline"}>
        <Link href="/auth/login">Sign in</Link>
      </Button>
      <Button asChild size="sm" variant={"default"}>
        <Link href="/auth/sign-up">Sign up</Link>
      </Button>
    </div>
  );
}
