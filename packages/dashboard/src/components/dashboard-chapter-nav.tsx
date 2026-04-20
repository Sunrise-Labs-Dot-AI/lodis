"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

type NavEntry = { id: string; title: string };

export function DashboardChapterNav({ chapters }: { chapters: NavEntry[] }) {
  const [active, setActive] = useState<string | null>(chapters[0]?.id ?? null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sections = chapters
      .map((c) => document.getElementById(c.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.25, 0.5, 1] },
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [chapters]);

  return (
    <nav aria-label="Chapter navigation" className="sticky top-20">
      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--text-dim)] mb-3">
        Chapters
      </p>
      <ul className="flex flex-col gap-0.5">
        {chapters.map((c) => {
          const isActive = active === c.id;
          return (
            <li key={c.id}>
              <a
                href={`#${c.id}`}
                className={clsx(
                  "block text-sm py-1.5 pl-3 -ml-[2px] border-l-2 transition-colors whitespace-nowrap",
                  isActive
                    ? "text-[var(--text)] border-[#a78bfa]"
                    : "text-[var(--text-muted)] border-transparent hover:text-[var(--text)]",
                )}
              >
                {c.title}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
