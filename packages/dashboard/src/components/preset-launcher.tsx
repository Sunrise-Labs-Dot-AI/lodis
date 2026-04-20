"use client";

import { useState } from "react";
import { Briefcase, Home, Lock } from "lucide-react";
import { PresetModal } from "@/components/preset-modal";
import type { Preset } from "@/app/agents/actions";

interface PresetLauncherProps {
  agentId: string;
  agentName: string;
  availableDomains: string[];
  sensitiveDomains: string[];
  existingRuleDomains: string[];
}

const presets: { value: Preset; label: string; glyph: React.ReactNode; caption: string }[] = [
  { value: "work", label: "Work", glyph: <Briefcase size={14} aria-hidden="true" />, caption: "Pick work domains" },
  { value: "personal", label: "Personal", glyph: <Home size={14} aria-hidden="true" />, caption: "Pick personal domains" },
  { value: "lockdown", label: "Lockdown", glyph: <Lock size={14} aria-hidden="true" />, caption: "Block everything" },
];

export function PresetLauncher(props: PresetLauncherProps) {
  const [active, setActive] = useState<Preset | null>(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {presets.map(p => (
          <button
            key={p.value}
            type="button"
            onClick={() => setActive(p.value)}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
          >
            <span className="text-[var(--accent)]">{p.glyph}</span>
            <span className="flex flex-col items-start leading-tight">
              <span className="font-medium">{p.label}</span>
              <span className="text-[10px] text-[var(--text-dim)]">{p.caption}</span>
            </span>
          </button>
        ))}
      </div>
      {active && (
        <PresetModal
          open={true}
          onClose={() => setActive(null)}
          preset={active}
          {...props}
        />
      )}
    </>
  );
}
