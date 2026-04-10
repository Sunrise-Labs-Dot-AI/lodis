"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Archive, Brain, Network, Shield, Settings, Sparkles } from "lucide-react";
import { UserButton } from "@clerk/nextjs";

const links = [
  { href: "/", label: "Memories", icon: Brain },
  { href: "/archive", label: "Archive", icon: Archive },
  // { href: "/graph", label: "Graph", icon: Network }, // Hidden until D3 errors are resolved
  { href: "/cleanup", label: "Cleanup", icon: Sparkles },
  { href: "/agents", label: "Agents", icon: Shield },
  { href: "/settings", label: "Settings", icon: Settings },
];

const isHosted = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function Nav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-3">
      <nav className="flex items-center gap-1 p-1 bg-[var(--color-bg-soft)] rounded-lg">
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                active
                  ? "text-[var(--color-accent-text)] bg-[var(--color-accent-soft)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[rgba(125,211,252,0.05)]",
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>
      {isHosted && <UserButton />}
    </div>
  );
}
