"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Github, X } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "lodis-local-first-banner-dismissed";
const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/not-invited", "/not-authorized"];

export function LocalFirstBanner() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  if (dismissed || PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return null;
  }

  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)] backdrop-blur-xl">
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-start gap-3">
        <div className="min-w-0 flex-1 text-xs sm:text-sm text-[var(--text-muted)] leading-5">
          <span className="text-[var(--text)] font-medium">Lodis is now local-first.</span>{" "}
          The recommended install is{" "}
          <code className="px-1.5 py-0.5 rounded bg-[var(--bg-soft)] text-[var(--accent-strong)] font-mono text-[0.9em]">
            npx -y @sunriselabs/lodis
          </code>{" "}
          against{" "}
          <code className="px-1.5 py-0.5 rounded bg-[var(--bg-soft)] text-[var(--accent-strong)] font-mono text-[0.9em]">
            ~/.lodis/lodis.db
          </code>
          . This hosted dashboard remains available as a private beta.
        </div>
        <Link
          href="https://github.com/Sunrise-Labs-Dot-AI/lodis"
          className="hidden sm:inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--accent-strong)] hover:bg-[var(--accent-soft)] transition-colors"
          aria-label="Open Lodis on GitHub"
        >
          <Github size={16} />
        </Link>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-soft)] transition-colors"
          aria-label="Dismiss local-first banner"
          onClick={() => {
            window.localStorage.setItem(STORAGE_KEY, "1");
            setDismissed(true);
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
