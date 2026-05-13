import Link from "next/link";

export default function NotAuthorizedPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md w-full text-center space-y-6 px-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-[var(--text)]">
            Access restricted
          </h1>
          <p className="text-[var(--text-muted)] text-sm leading-relaxed">
            This account does not have access to Lodis cloud. Cloud is in
            private access — new accounts are provisioned manually.
          </p>
        </div>

        <a
          href="mailto:james.stine.heath@gmail.com?subject=Lodis%20cloud%20access%20request"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] text-[var(--void)] text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Request Access
        </a>

        <p className="text-[var(--text-dim)] text-xs">
          <Link href="/sign-in" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors underline underline-offset-2">
            Sign in with a different account
          </Link>
        </p>
      </div>
    </div>
  );
}
