import { SignOutButton } from "@clerk/nextjs";

export const metadata = {
  title: "Lodis — Private Beta",
};

export default function NotInvitedPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md w-full bg-[rgba(15,23,42,0.8)] backdrop-blur-xl border border-[var(--border)] rounded-2xl p-8 text-center">
        <h1 className="text-xl font-bold text-[var(--accent)] mb-2">
          Lodis is in private beta
        </h1>
        <p className="text-sm text-[var(--muted)] mb-6 leading-relaxed">
          Your account isn&apos;t on the access list yet. If you&apos;d like to
          try Lodis, email{" "}
          <a
            href="mailto:hello@sunriselabs.ai?subject=Lodis%20beta%20access"
            className="text-[var(--accent)] underline"
          >
            hello@sunriselabs.ai
          </a>{" "}
          and we&apos;ll add you.
        </p>
        <SignOutButton redirectUrl="/sign-in">
          <button
            type="button"
            className="text-sm text-[var(--muted)] hover:text-[var(--fg)] transition-colors underline"
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </div>
  );
}
