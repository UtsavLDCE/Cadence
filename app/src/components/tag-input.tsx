"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type Tag = { id: string; name: string };

// Shared tag state for a page: loads the team-wide vocabulary once and exposes a
// create that appends the new tag (so every input on the page sees it instantly).
// Held at the top of the client tree and passed down, so nested rows don't refetch.
export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/tags")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Tag[]) => {
        if (alive) setTags(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Create (or reuse) a tag by name. Returns the tag row; the vocabulary is kept
  // deduped and alphabetical so suggestions stay stable.
  const createTag = useCallback(async (name: string): Promise<Tag | null> => {
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const tag: Tag = await res.json();
    setTags((prev) =>
      prev.some((t) => t.id === tag.id)
        ? prev
        : [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)),
    );
    return tag;
  }, []);

  return { tags, createTag };
}

// A multi-select tag picker with inline create. Presentational: the parent owns
// the vocabulary (via useTags) and the selected set. `value` is the currently
// selected tags; `onChange` receives the full new selection so the parent can
// persist tagIds and mirror the objects locally.
export function TagInput({
  value,
  onChange,
  suggestions,
  onCreate,
  className,
  disabled,
}: {
  value: Tag[];
  onChange: (next: Tag[]) => void;
  suggestions: Tag[];
  onCreate: (name: string) => Promise<Tag | null>;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const selectedIds = useMemo(() => new Set(value.map((t) => t.id)), [value]);
  const query = text.trim().toLowerCase();
  const matches = suggestions
    .filter((t) => !selectedIds.has(t.id) && t.name.toLowerCase().includes(query))
    .slice(0, 8);
  const exact = suggestions.find((t) => t.name.toLowerCase() === query);

  // Close the suggestion menu on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function add(tag: Tag) {
    if (!selectedIds.has(tag.id)) onChange([...value, tag]);
    setText("");
  }

  function remove(id: string) {
    onChange(value.filter((t) => t.id !== id));
  }

  async function commitText() {
    const name = text.trim();
    if (!name) return;
    // Reuse an already-selected tag typed again, or an existing vocabulary match,
    // before creating — keeps the set case-insensitively deduped.
    const already = value.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (already) {
      setText("");
      return;
    }
    if (exact) {
      add(exact);
      return;
    }
    setBusy(true);
    const tag = await onCreate(name);
    setBusy(false);
    if (tag) add(tag);
  }

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-1 border border-gray-200 rounded-lg px-2 py-1.5 bg-white min-h-[38px] focus-within:ring-2 focus-within:ring-[#f4502e55]",
          disabled && "opacity-50 pointer-events-none",
        )}
      >
        {value.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 text-[11px] font-medium bg-sky-100 text-sky-700 rounded px-1.5 py-0.5"
          >
            #{t.name}
            <button
              type="button"
              onClick={() => remove(t.id)}
              className="text-sky-500 hover:text-sky-800 leading-none"
              title="Remove tag"
            >
              ✕
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            } else if (e.key === "Backspace" && text === "" && value.length > 0) {
              remove(value[value.length - 1].id);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={value.length === 0 ? "Add tags…" : ""}
          className="flex-1 min-w-[70px] text-xs outline-none bg-transparent py-0.5"
        />
      </div>

      {open && (query !== "" || matches.length > 0) && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-52 overflow-auto">
          {matches.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                add(t);
                setOpen(true);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              #{t.name}
            </button>
          ))}
          {query !== "" && !exact && (
            <button
              type="button"
              onClick={commitText}
              disabled={busy}
              className="w-full text-left px-3 py-1.5 text-xs text-primary hover:bg-primary-soft disabled:opacity-50"
            >
              {busy ? "Adding…" : `+ Create “${text.trim()}”`}
            </button>
          )}
          {matches.length === 0 && query === "" && (
            <p className="px-3 py-1.5 text-xs text-gray-400">Type to search or create a tag.</p>
          )}
        </div>
      )}
    </div>
  );
}

// Read-only tag badges for display rows. Renders nothing when there are no tags.
export function TagBadges({ tags, className }: { tags: Tag[]; className?: string }) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {tags.map((t) => (
        <span
          key={t.id}
          className="text-[10px] font-medium bg-sky-100 text-sky-700 rounded px-1.5 py-0.5"
        >
          #{t.name}
        </span>
      ))}
    </span>
  );
}
