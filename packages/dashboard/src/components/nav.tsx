"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Archive, BookOpen, Brain, FileText, Shield, Settings, Sparkles } from "lucide-react";
import { UserButton } from "@clerk/nextjs";

const links = [
  { href: "/", label: "Memories", icon: Brain },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/archive", label: "Archive", icon: Archive },
  { href: "/cleanup", label: "Cleanup", icon: Sparkles },
  { href: "/agents", label: "Agents", icon: Shield },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/how-it-works", label: "How", icon: BookOpen },
];

const isHosted = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Close on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex items-center gap-3">
      {/* Desktop nav */}
      <nav className="hidden md:flex items-center gap-1 p-1 bg-[var(--bg-soft)] rounded-lg">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
              isActive(href)
                ? "text-[var(--accent-strong)] bg-[var(--accent-soft)]"
                : "text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[rgba(125,211,252,0.05)]",
            )}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>
      {isHosted && <UserButton />}

      {/* Mobile hamburger */}
      <button
        type="button"
        className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-md text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
        aria-expanded={open}
        aria-controls="dashboard-mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
          )}
        </svg>
      </button>

      {/* Mobile sheet — portalled to body to escape the header's
          backdrop-filter containing block */}
      {mounted &&
        open &&
        createPortal(
          <div
            id="dashboard-mobile-nav"
            className="md:hidden fixed left-0 right-0 top-[57px] z-[60] border-b border-[var(--border)] bg-[#0a0e1a] shadow-2xl"
          >
            <nav className="max-w-5xl mx-auto px-4 py-3 flex flex-col gap-1">
              {links.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={clsx(
                    "flex items-center gap-2 px-3 py-2.5 rounded-md text-base font-medium transition-colors",
                    isActive(href)
                      ? "text-[var(--accent-strong)] bg-[var(--accent-soft)]"
                      : "text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-soft)]",
                  )}
                >
                  <Icon size={18} />
                  {label}
                </Link>
              ))}
            </nav>
          </div>,
          document.body,
        )}
    </div>
  );
}
