"use client";

import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";

const isHosted = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const linkClasses =
  "text-sm text-[var(--muted)] hover:text-[var(--fg)] transition-colors underline";

export function NotInvitedActions() {
  if (!isHosted) {
    return (
      <Link href="/sign-in" className={linkClasses}>
        Back to sign in
      </Link>
    );
  }

  return (
    <SignOutButton redirectUrl="/sign-in">
      <button type="button" className={linkClasses}>
        Sign out
      </button>
    </SignOutButton>
  );
}
