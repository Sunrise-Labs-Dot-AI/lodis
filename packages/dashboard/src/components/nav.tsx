"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Brain, Network, Shield, Settings, Sparkles } from "lucide-react";

const links = [
  { href: "/", label: "Memories", icon: Brain },
  { href: "/graph", label: "Graph", icon: Network },
  { href: "/cleanup", label: "Cleanup", icon: Sparkles },
  { href: "/agents", label: "Agents", icon: Shield },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();

  return (
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
                ? "bg-[var(--color-card)] text-[var(--color-accent-text)] shadow-sm"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            <Icon size={16} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
