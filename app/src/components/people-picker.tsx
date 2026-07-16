"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type Person = { id: string; name: string | null; email: string | null };

export function personLabel(p: Person): string {
  return p.name || p.email || "Unknown";
}

// Loads the shareable roster (every user but you) once and holds it at the top of
// the client tree so nested pickers don't refetch. Mirrors useTags/useCategories.
export function usePeople() {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/people")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Person[]) => { if (alive) setPeople(data); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return people;
}

// A searchable multi-select of people, rendered as chips + a dropdown. Presentational:
// the parent owns the selection (`value`) and the roster (`options`). No inline create —
// you can only share with users that already exist.
export function PeoplePicker({
  value,
  onChange,
  options,
  className,
  placeholder = "Search people…",
}: {
  value: Person[];
  onChange: (next: Person[]) => void;
  options: Person[];
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const selectedIds = useMemo(() => new Set(value.map((p) => p.id)), [value]);
  const query = text.trim().toLowerCase();
  const matches = options
    .filter((p) => !selectedIds.has(p.id) && personLabel(p).toLowerCase().includes(query))
    .slice(0, 8);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const add = useCallback((p: Person) => {
    if (!selectedIds.has(p.id)) onChange([...value, p]);
    setText("");
  }, [onChange, selectedIds, value]);

  function remove(id: string) {
    onChange(value.filter((p) => p.id !== id));
  }

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <div className="flex flex-wrap items-center gap-1 border border-[#ece8e1] rounded-lg px-2 py-1.5 bg-white min-h-[38px] focus-within:ring-2 focus-within:ring-[#e0533a55]">
        {value.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1 text-[11px] font-medium bg-indigo-100 text-indigo-700 rounded px-1.5 py-0.5"
          >
            {personLabel(p)}
            <button
              type="button"
              onClick={() => remove(p.id)}
              className="text-indigo-500 hover:text-indigo-800 leading-none"
              title="Remove"
            >
              ✕
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); if (matches[0]) add(matches[0]); }
            else if (e.key === "Backspace" && text === "" && value.length > 0) remove(value[value.length - 1].id);
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[90px] text-xs outline-none bg-transparent py-0.5"
        />
      </div>

      {open && (query !== "" || matches.length > 0) && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-[#ece8e1] rounded-lg shadow-lg py-1 max-h-52 overflow-auto">
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { add(p); setOpen(true); }}
              className="w-full text-left px-3 py-1.5 text-xs text-[#4a453e] hover:bg-[#f6f4f1]"
            >
              {personLabel(p)}
            </button>
          ))}
          {matches.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-[#b0a99e]">
              {query === "" ? "Type to search people." : "No match."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
