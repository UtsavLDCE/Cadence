"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const base =
    "text-sm border border-[#ece8e1] rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]";

  async function submitNew() {
    const n = name.trim();
    if (!n) {
      setAdding(false);
      return;
    }
    setBusy(true);
    const cat = await onCreate(n);
    setBusy(false);
    if (cat) {
      onChange(cat.id);
      setName("");
      setAdding(false);
    }
  }

  if (adding) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitNew();
            } else if (e.key === "Escape") {
              setAdding(false);
              setName("");
            }
          }}
          autoFocus
          maxLength={60}
          placeholder="New category…"
          className={cn(base, "flex-1 min-w-0")}
        />
        <button
          type="button"
          onClick={submitNew}
          disabled={busy || !name.trim()}
          className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-medium px-2.5 py-2 rounded-lg transition-colors shrink-0"
        >
          {busy ? "…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAdding(false);
            setName("");
          }}
          className="text-xs text-[#b0a99e] hover:text-[#6b665f] px-1 shrink-0"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      title={title}
      onChange={(e) => {
        if (e.target.value === "__new__") setAdding(true);
        else onChange(e.target.value || null);
      }}
      className={cn(base, className)}
    >
      <option value="">Uncategorized</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value="__new__">+ Add category…</option>
    </select>
  );
}
