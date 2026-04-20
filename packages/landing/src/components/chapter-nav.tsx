"use client";

import { useEffect, useState } from "react";

type NavEntry = { id: string; title: string };

export function ChapterNav({ chapters }: { chapters: NavEntry[] }) {
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
    <nav aria-label="Chapter navigation" className="chapter-nav">
      <p className="chapter-nav-label">Chapters</p>
      <ul>
        {chapters.map((c) => (
          <li key={c.id}>
            <a
              href={`#${c.id}`}
              data-active={active === c.id}
              className="chapter-nav-link"
            >
              {c.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
