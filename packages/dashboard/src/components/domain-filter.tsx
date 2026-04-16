"use client";

import clsx from "clsx";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";

interface DomainFilterProps {
  domains: { domain: string; count: number }[];
}

const VISIBLE_COUNT = 8;

export function DomainFilter({ domains }: DomainFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const activeDomain = searchParams.get("domain");
  const [, startTransition] = useTransition();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Sort domains by count desc (stable)
  const sorted = useMemo(
    () => [...domains].sort((a, b) => b.count - a.count),
    [domains],
  );

  // Keep active domain visible inline even if outside top-N
  const activeIdx = sorted.findIndex((d) => d.domain === activeDomain);
  let visible = sorted.slice(0, VISIBLE_COUNT);
  let overflow = sorted.slice(VISIBLE_COUNT);
  if (activeIdx >= VISIBLE_COUNT) {
    const activeItem = sorted[activeIdx];
    visible = [...sorted.slice(0, VISIBLE_COUNT - 1), activeItem];
    overflow = [
      ...sorted.slice(VISIBLE_COUNT - 1, activeIdx),
      ...sorted.slice(activeIdx + 1),
    ];
  }

  const filteredOverflow = useMemo(() => {
    if (!filterText.trim()) return overflow;
    const q = filterText.toLowerCase();
    return overflow.filter((d) => d.domain.toLowerCase().includes(q));
  }, [overflow, filterText]);

  function selectDomain(domain: string | null) {
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (domain) {
        params.set("domain", domain);
      } else {
        params.delete("domain");
      }
      router.replace(`/?${params.toString()}`);
    });
    setOverflowOpen(false);
    setFilterText("");
  }

  // Escape, outside click
  useEffect(() => {
    if (!overflowOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOverflowOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOverflowOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    // Focus the filter input when opened
    queueMicrotask(() => searchInputRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [overflowOpen]);

  // Close on route change
  useEffect(() => {
    setOverflowOpen(false);
  }, [pathname]);

  const chipClass = (active: boolean) =>
    clsx(
      "px-2.5 py-1 text-xs font-medium rounded-full transition-colors cursor-pointer whitespace-nowrap",
      active
        ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
        : "bg-[var(--bg-soft)] text-[var(--text-dim)] hover:text-[var(--text)]",
    );

  return (
    <div className="relative flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => selectDomain(null)}
        className={chipClass(!activeDomain)}
      >
        All
      </button>
      {visible.map(({ domain, count }) => (
        <button
          key={domain}
          type="button"
          onClick={() => selectDomain(domain)}
          className={chipClass(activeDomain === domain)}
        >
          {domain}
          <span className="ml-1 opacity-60">{count}</span>
        </button>
      ))}
      {overflow.length > 0 && (
        <>
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={overflowOpen}
            aria-haspopup="dialog"
            onClick={() => setOverflowOpen((v) => !v)}
            className={clsx(
              "px-2.5 py-1 text-xs font-medium rounded-full transition-colors cursor-pointer inline-flex items-center gap-1",
              overflowOpen
                ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                : "bg-[var(--bg-soft)] text-[var(--text-dim)] hover:text-[var(--text)]",
            )}
          >
            +{overflow.length} more
            <ChevronDown size={11} className={overflowOpen ? "rotate-180" : ""} />
          </button>
          {overflowOpen && (
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="All domains"
              className="absolute left-0 top-full mt-2 z-30 w-72 max-w-[calc(100vw-2rem)] p-3 rounded-lg border border-[var(--border)] bg-[rgba(10,14,26,0.98)] backdrop-blur-xl shadow-2xl"
            >
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Filter domains…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setOverflowOpen(false);
                    triggerRef.current?.focus();
                  }
                }}
                className="w-full mb-2 px-2.5 py-1.5 text-xs bg-[var(--bg-soft)] border border-[var(--border)] rounded-md text-[var(--text)] placeholder:text-[var(--text-dim)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-solid)]"
              />
              <div className="max-h-60 overflow-y-auto flex flex-col gap-1">
                {filteredOverflow.length === 0 ? (
                  <p className="text-xs text-[var(--text-dim)] px-2 py-2">
                    No domains match.
                  </p>
                ) : (
                  filteredOverflow.map(({ domain, count }) => (
                    <button
                      key={domain}
                      type="button"
                      onClick={() => selectDomain(domain)}
                      className={clsx(
                        "flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md transition-colors cursor-pointer text-left",
                        activeDomain === domain
                          ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--text)]",
                      )}
                    >
                      <span className="truncate">{domain}</span>
                      <span className="ml-2 opacity-60">{count}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
