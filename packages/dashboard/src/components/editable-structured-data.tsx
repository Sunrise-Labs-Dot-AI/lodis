"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { directUpdateMemory } from "@/lib/db-actions";

// --- Schema registry ---

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "select" | "text-array";
  options?: string[];
}

const SCHEMAS: Record<string, FieldDef[]> = {
  person: [
    { key: "name", label: "Name", type: "text" },
    { key: "role", label: "Role", type: "text" },
    { key: "organization", label: "Organization", type: "text" },
    { key: "relationship_to_user", label: "Relationship", type: "text" },
  ],
  organization: [
    { key: "name", label: "Name", type: "text" },
    { key: "type", label: "Type", type: "text" },
    { key: "user_relationship", label: "Relationship", type: "text" },
  ],
  place: [
    { key: "name", label: "Name", type: "text" },
    { key: "context", label: "Context", type: "text" },
  ],
  project: [
    { key: "name", label: "Name", type: "text" },
    { key: "status", label: "Status", type: "text" },
    { key: "user_role", label: "Your role", type: "text" },
  ],
  preference: [
    { key: "category", label: "Category", type: "text" },
    { key: "strength", label: "Strength", type: "select", options: ["strong", "mild", "contextual"] },
  ],
  event: [
    { key: "what", label: "What", type: "text" },
    { key: "when", label: "When", type: "text" },
    { key: "who", label: "Who", type: "text-array" },
  ],
  goal: [
    { key: "what", label: "What", type: "text" },
    { key: "timeline", label: "Timeline", type: "text" },
    { key: "status", label: "Status", type: "select", options: ["active", "achieved", "abandoned"] },
  ],
  fact: [
    { key: "category", label: "Category", type: "text" },
  ],
  lesson: [
    { key: "topic", label: "Topic", type: "text" },
    { key: "context", label: "Context", type: "text" },
    { key: "source", label: "Source", type: "select", options: ["experience", "observation", "advice"] },
  ],
  routine: [
    { key: "activity", label: "Activity", type: "text" },
    { key: "frequency", label: "Frequency", type: "text" },
    { key: "status", label: "Status", type: "select", options: ["active", "lapsed", "aspirational"] },
  ],
  skill: [
    { key: "domain", label: "Domain", type: "text" },
    { key: "level", label: "Level", type: "select", options: ["beginner", "intermediate", "advanced", "expert"] },
    { key: "context", label: "Context", type: "text" },
  ],
  resource: [
    { key: "name", label: "Name", type: "text" },
    { key: "type", label: "Type", type: "select", options: ["tool", "service", "document", "url", "book", "other"] },
    { key: "url", label: "URL", type: "text" },
    { key: "purpose", label: "Purpose", type: "text" },
  ],
  decision: [
    { key: "what", label: "What", type: "text" },
    { key: "rationale", label: "Rationale", type: "text" },
    { key: "alternatives", label: "Alternatives", type: "text-array" },
    { key: "when", label: "When", type: "text" },
    { key: "status", label: "Status", type: "select", options: ["active", "revisiting", "reversed"] },
  ],
};

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(val: unknown): string {
  if (Array.isArray(val)) {
    return val.map((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join(", ");
  }
  if (typeof val === "object" && val !== null) {
    return JSON.stringify(val);
  }
  return String(val ?? "");
}

function isComplexValue(val: unknown): boolean {
  if (Array.isArray(val) && val.some((v) => typeof v === "object" && v !== null)) return true;
  if (typeof val === "object" && val !== null && !Array.isArray(val)) return true;
  return false;
}

// --- Component ---

interface EditableStructuredDataProps {
  id: string;
  entityType: string | null;
  structuredData: string | null;
}

export function EditableStructuredData({ id, entityType, structuredData }: EditableStructuredDataProps) {
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  let parsed: Record<string, unknown> = {};
  try {
    if (structuredData) parsed = JSON.parse(structuredData);
  } catch {
    // invalid JSON
  }

  const schema = entityType ? SCHEMAS[entityType] ?? null : null;
  const schemaKeys = schema ? schema.map((f) => f.key) : [];
  const extraKeys = Object.keys(parsed).filter((k) => !schemaKeys.includes(k));

  useEffect(() => {
    if (editingKey && inputRef.current) inputRef.current.focus();
  }, [editingKey]);

  async function saveField(key: string, rawValue: string, field?: FieldDef) {
    const isArray = field?.type === "text-array";
    const newVal = isArray
      ? rawValue.split(",").map((s) => s.trim()).filter(Boolean)
      : rawValue.trim() || undefined;

    const updated = { ...parsed, [key]: newVal };
    if (newVal === undefined) delete updated[key];

    setEditingKey(null);
    await directUpdateMemory(id, { structuredData: JSON.stringify(updated) });
    router.refresh();
  }

  function startEditing(key: string) {
    const val = parsed[key];
    setEditValue(formatValue(val));
    setEditingKey(key);
  }

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderField(key: string, label: string, field?: FieldDef, isExtra?: boolean) {
    const val = parsed[key];
    const displayValue = formatValue(val);
    const isEditing = editingKey === key;
    const complex = isComplexValue(val);
    const expanded = expandedKeys.has(key);

    if (isEditing && field?.type === "select") {
      return (
        <div key={key} className={isExtra ? "col-span-2 sm:col-span-1" : ""}>
          <span className="text-[var(--color-text-muted)]">{label}</span>
          <select
            autoFocus
            value={String(val ?? "")}
            onChange={(e) => saveField(key, e.target.value, field)}
            onBlur={() => setEditingKey(null)}
            className="block w-full mt-0.5 px-1.5 py-0.5 text-sm bg-[var(--color-bg-soft)] border border-[var(--color-accent-solid)] rounded focus:outline-none cursor-pointer"
          >
            <option value="">-</option>
            {field.options?.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      );
    }

    if (isEditing) {
      return (
        <div key={key} className={complex ? "col-span-2" : isExtra ? "col-span-2 sm:col-span-1" : ""}>
          <span className="text-[var(--color-text-muted)]">{label}</span>
          <div className="flex items-center gap-1 mt-0.5">
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveField(key, editValue, field);
                if (e.key === "Escape") setEditingKey(null);
              }}
              placeholder={field?.type === "text-array" ? "comma-separated..." : ""}
              className="flex-1 px-1.5 py-0.5 text-sm bg-[var(--color-bg-soft)] border border-[var(--color-accent-solid)] rounded focus:outline-none min-w-0"
            />
            <button
              onClick={() => saveField(key, editValue, field)}
              className="p-0.5 text-[var(--color-success)] rounded cursor-pointer shrink-0"
            >
              <Check size={12} />
            </button>
            <button
              onClick={() => setEditingKey(null)}
              className="p-0.5 text-[var(--color-text-muted)] rounded cursor-pointer shrink-0"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      );
    }

    // Complex values span full width and truncate
    if (complex) {
      return (
        <div
          key={key}
          className="col-span-2 group cursor-pointer hover:bg-[var(--color-bg-soft)] rounded px-1 -mx-1 transition-colors"
          onClick={() => startEditing(key)}
        >
          <div className="flex items-center justify-between">
            <span className="text-[var(--color-text-muted)]">{label}</span>
            {displayValue.length > 80 && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleExpand(key); }}
                className="text-xs text-[var(--color-accent-text)] hover:underline cursor-pointer"
              >
                {expanded ? "collapse" : "expand"}
              </button>
            )}
          </div>
          <p className={`font-medium text-xs break-all ${expanded ? "" : "line-clamp-2"}`}>
            {displayValue}
            <Pencil size={8} className="inline ml-1 opacity-0 group-hover:opacity-50 transition-opacity" />
          </p>
        </div>
      );
    }

    return (
      <div
        key={key}
        className={`group cursor-pointer hover:bg-[var(--color-bg-soft)] rounded px-1 -mx-1 transition-colors overflow-hidden ${isExtra ? "col-span-2 sm:col-span-1" : ""}`}
        onClick={() => startEditing(key)}
      >
        <span className="text-[var(--color-text-muted)]">{label}</span>
        <p className="font-medium truncate">
          {displayValue || <span className="text-[var(--color-text-muted)] italic font-normal">-</span>}
          <Pencil size={8} className="inline ml-1 opacity-0 group-hover:opacity-50 transition-opacity" />
        </p>
      </div>
    );
  }

  // Nothing to show if no schema and no data
  if (!schema && Object.keys(parsed).length === 0) return null;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-3">Structured Data</h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        {/* Schema-defined fields */}
        {schema?.map((f) => renderField(f.key, f.label, f))}

        {/* Extra keys not in schema */}
        {extraKeys.length > 0 && schema && (
          <div className="col-span-2 border-t border-[rgba(148,163,184,0.1)] mt-1 pt-2">
            <span className="text-xs text-[var(--color-text-muted)]">Additional fields</span>
          </div>
        )}
        {extraKeys.map((key) => renderField(key, humanizeKey(key), undefined, true))}
      </div>
    </Card>
  );
}
