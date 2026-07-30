"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type Category = {
  id: string;
  name: string;
  kind: string | null;
  sortOrder: number;
  isDefault: boolean;
};

// Shared category state for a page: loads the team-wide vocabulary once and
// exposes a create that appends the new category (so every selector on the page
// sees it immediately). Kept at the top of each client tree and passed down, so
// nested forms/rows don't each re-fetch.
export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/categories")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Category[]) => {
        if (alive) setCategories(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const createCategory = useCallback(async (name: string): Promise<Category | null> => {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const cat: Category = await res.json();
    setCategories((prev) =>
      prev.some((c) => c.id === cat.id)
        ? prev
        : [...prev, cat].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    );
    return cat;
  }, []);

  return { categories, createCategory };
}

// Look up a category name by id for read-only display (badges).
export function categoryName(categories: Category[], id: string | null | undefined): string | null {
  if (!id) return null;
  return categories.find((c) => c.id === id)?.name ?? null;
}

// A category picker with inline "add new". Presentational: the parent owns the
// list (via useCategories) and passes value/onChange plus the create callback, so
// a newly-added category is instantly selectable everywhere on the page.
export function CategorySelect({
  categories,
  value,
  onChange,
  onCreate,
  className,
  disabled,
  title = "Category",
}: {
  categories: Category[];
  value: string | null;
  onChange: (id: string | null) => void;
  onCreate: (name: string) => Promise<Category | null>;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const base =
    "text-sm border border-[#ece8e1] rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]";

  const selectedName = value ? categories.find((c) => c.id === value)?.name : null;

  const query = text.trim().toLowerCase();
  const matches = useMemo(
    () => categories.filter((c) => c.name.toLowerCase().includes(query)),
    [categories, query],
  );
  const exact = categories.some((c) => c.name.toLowerCase() === query);
  const canCreate = query !== "" && !exact;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = useCallback((id: string | null) => {
    onChange(id);
    setText("");
    setOpen(false);
  }, [onChange]);

  async function submitNew() {
    const n = text.trim();
    if (!n) return;
    setBusy(true);
    const cat = await onCreate(n);
    setBusy(false);
    if (cat) pick(cat.id);
  }

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        title={title}
        onClick={() => setOpen((o) => !o)}
        className={cn(base, "w-full text-left flex items-center justify-between gap-2 disabled:opacity-50")}
      >
        <span className={cn("truncate", !selectedName && "text-[#b0a99e]")}>
          {selectedName ?? "Uncategorized"}
        </span>
        <span className="text-[#b0a99e] shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[12rem] bg-white border border-[#ece8e1] rounded-lg shadow-lg py-1">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (matches[0]) pick(matches[0].id);
                else if (canCreate) submitNew();
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            autoFocus
            maxLength={60}
            placeholder="Search or add…"
            className="w-full text-sm px-3 py-1.5 border-b border-[#ece8e1] outline-none"
          />
          <div className="max-h-52 overflow-auto py-1">
            {query === "" && (
              <button
                type="button"
                onClick={() => pick(null)}
                className="w-full text-left px-3 py-1.5 text-sm text-[#4a453e] hover:bg-[#f6f4f1]"
              >
                Uncategorized
              </button>
            )}
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c.id)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-sm text-[#4a453e] hover:bg-[#f6f4f1]",
                  c.id === value && "font-medium bg-[#f6f4f1]",
                )}
              >
                {c.name}
              </button>
            ))}
            {matches.length === 0 && !canCreate && (
              <p className="px-3 py-1.5 text-xs text-[#b0a99e]">No match.</p>
            )}
            {canCreate && (
              <button
                type="button"
                onClick={submitNew}
                disabled={busy}
                className="w-full text-left px-3 py-1.5 text-sm text-primary hover:bg-[#f6f4f1] disabled:opacity-50"
              >
                {busy ? "Adding…" : `+ Add “${text.trim()}”`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
