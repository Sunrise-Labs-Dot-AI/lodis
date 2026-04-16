"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X, ShieldAlert, Star, Clock, Archive } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { sourceTypeLabel } from "@/lib/utils";
import { directUpdateMemory } from "@/lib/db-actions";

const ENTITY_TYPES = [
  "person",
  "organization",
  "place",
  "project",
  "preference",
  "event",
  "goal",
  "fact",
  "lesson",
  "routine",
  "skill",
  "resource",
  "decision",
] as const;

interface EditableMetadataProps {
  id: string;
  domain: string;
  entityType: string | null;
  entityName: string | null;
  sourceType: string;
  sourceAgentName: string;
  sourceDescription: string | null;
  permanence: string | null;
  hasPiiFlag: boolean;
}

export function EditableMetadata({
  id,
  domain,
  entityType,
  entityName,
  sourceType,
  sourceAgentName,
  sourceDescription,
  permanence,
  hasPiiFlag,
}: EditableMetadataProps) {
  const router = useRouter();

  const [editingDomain, setEditingDomain] = useState(false);
  const [domainValue, setDomainValue] = useState(domain);
  const domainRef = useRef<HTMLInputElement>(null);

  const [editingEntityType, setEditingEntityType] = useState(false);

  const [editingEntityName, setEditingEntityName] = useState(false);
  const [entityNameValue, setEntityNameValue] = useState(entityName ?? "");
  const entityNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingDomain && domainRef.current) domainRef.current.focus();
  }, [editingDomain]);

  useEffect(() => {
    if (editingEntityName && entityNameRef.current) entityNameRef.current.focus();
  }, [editingEntityName]);

  async function save(fields: Record<string, unknown>) {
    await directUpdateMemory(id, fields);
    router.refresh();
  }

  async function saveDomain() {
    const v = domainValue.trim() || "general";
    if (v === domain) {
      setEditingDomain(false);
      return;
    }
    setEditingDomain(false);
    await save({ domain: v });
  }

  async function saveEntityType(value: string) {
    const v = value || null;
    setEditingEntityType(false);
    if (v === entityType) return;
    await save({ entityType: v });
  }

  async function saveEntityName() {
    const v = entityNameValue.trim() || null;
    if (v === entityName) {
      setEditingEntityName(false);
      return;
    }
    setEditingEntityName(false);
    await save({ entityName: v });
  }

  const inputClass =
    "px-2 py-0.5 text-xs bg-[var(--bg-soft)] border border-[var(--accent-solid)] rounded-full focus:outline-none";
  const iconBtnClass = "p-0.5 rounded cursor-pointer";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Domain — editable */}
      {editingDomain ? (
        <span className="inline-flex items-center gap-1">
          <input
            ref={domainRef}
            value={domainValue}
            onChange={(e) => setDomainValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveDomain();
              if (e.key === "Escape") {
                setDomainValue(domain);
                setEditingDomain(false);
              }
            }}
            className={inputClass}
            style={{ width: `${Math.max(domainValue.length, 4) + 2}ch` }}
          />
          <button onClick={saveDomain} className={`${iconBtnClass} text-[var(--success)]`}>
            <Check size={12} />
          </button>
          <button
            onClick={() => { setDomainValue(domain); setEditingDomain(false); }}
            className={`${iconBtnClass} text-[var(--text-dim)]`}
          >
            <X size={12} />
          </button>
        </span>
      ) : (
        <StatusBadge
          variant="accent"
          className="cursor-pointer hover:ring-1 hover:ring-[var(--accent-solid)] transition-shadow"
        >
          <span onClick={() => setEditingDomain(true)}>
            {domain}
            <Pencil size={8} className="inline ml-1 opacity-50" />
          </span>
        </StatusBadge>
      )}

      {/* Source type — read-only */}
      <StatusBadge variant="neutral">{sourceTypeLabel(sourceType)}</StatusBadge>

      {/* Permanence badges — read-only */}
      {permanence === "canonical" && (
        <StatusBadge variant="accent">
          <Star size={12} className="mr-0.5 inline fill-current" />
          Canonical
        </StatusBadge>
      )}
      {permanence === "ephemeral" && (
        <StatusBadge variant="warning">
          <Clock size={12} className="mr-0.5 inline" />
          Ephemeral
        </StatusBadge>
      )}
      {permanence === "archived" && (
        <StatusBadge variant="neutral">
          <Archive size={12} className="mr-0.5 inline" />
          Archived
        </StatusBadge>
      )}

      {/* Entity type — editable dropdown */}
      {editingEntityType ? (
        <select
          autoFocus
          value={entityType ?? ""}
          onChange={(e) => saveEntityType(e.target.value)}
          onBlur={() => setEditingEntityType(false)}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="">None</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      ) : (
        <StatusBadge
          variant="neutral"
          className="cursor-pointer hover:ring-1 hover:ring-[var(--accent-solid)] transition-shadow"
        >
          <span onClick={() => setEditingEntityType(true)}>
            {entityType ?? "no type"}
            <Pencil size={8} className="inline ml-1 opacity-50" />
          </span>
        </StatusBadge>
      )}

      {/* Entity name — editable */}
      {editingEntityName ? (
        <span className="inline-flex items-center gap-1">
          <input
            ref={entityNameRef}
            value={entityNameValue}
            onChange={(e) => setEntityNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEntityName();
              if (e.key === "Escape") {
                setEntityNameValue(entityName ?? "");
                setEditingEntityName(false);
              }
            }}
            placeholder="Entity name..."
            className={inputClass}
            style={{ width: `${Math.max(entityNameValue.length, 8) + 2}ch` }}
          />
          <button onClick={saveEntityName} className={`${iconBtnClass} text-[var(--success)]`}>
            <Check size={12} />
          </button>
          <button
            onClick={() => { setEntityNameValue(entityName ?? ""); setEditingEntityName(false); }}
            className={`${iconBtnClass} text-[var(--text-dim)]`}
          >
            <X size={12} />
          </button>
        </span>
      ) : entityName ? (
        <StatusBadge
          variant="neutral"
          className="cursor-pointer hover:ring-1 hover:ring-[var(--accent-solid)] transition-shadow"
        >
          <span onClick={() => setEditingEntityName(true)}>
            {entityName}
            <Pencil size={8} className="inline ml-1 opacity-50" />
          </span>
        </StatusBadge>
      ) : (
        <span
          className="text-xs text-[var(--text-dim)] italic cursor-pointer hover:text-[var(--text-muted)] transition-colors"
          onClick={() => setEditingEntityName(true)}
        >
          + name
        </span>
      )}

      {/* PII flag — read-only */}
      {hasPiiFlag && (
        <StatusBadge variant="warning">
          <ShieldAlert size={12} className="mr-0.5 inline" />
          Contains sensitive data
        </StatusBadge>
      )}

      {/* Source info — read-only */}
      <span className="text-xs text-[var(--text-dim)]">
        by {sourceAgentName}
      </span>
      {sourceDescription && (
        <span className="text-xs text-[var(--text-dim)] italic">
          — {sourceDescription}
        </span>
      )}
    </div>
  );
}
