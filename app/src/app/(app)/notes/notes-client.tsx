"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";

type Note = { id: string; title: string | null; body: string; done: boolean | null; createdAt: string };

// Group notes (already newest-first) into date buckets keyed on the UTC calendar
// day, preserving order. One heading per day, notes under it — the "single feed,
// date wise" view.
function groupByDay(notes: Note[]): { day: string; notes: Note[] }[] {
  const groups: { day: string; notes: Note[] }[] = [];
  for (const n of notes) {
    const day = n.createdAt.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.notes.push(n);
    else groups.push({ day, notes: [n] });
  }
  return groups;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function NotesClient({ notes }: { notes: Note[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const groups = groupByDay(notes);

  function startEdit(n: Note) {
    setEditId(n.id);
    setEditTitle(n.title ?? "");
    setEditBody(n.body);
  }

  async function saveEdit(id: string) {
    const text = editBody.trim();
    if (!text) return;
    await fetch("/api/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title: editTitle.trim(), body: text }),
    });
    setEditId(null);
    router.refresh();
  }

  async function add() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), body: text }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Couldn't save that note.");
      return;
    }
    setTitle("");
    setBody("");
    router.refresh();
  }

  async function toggle(id: string, done: boolean) {
    await fetch("/api/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, done }),
    });
    router.refresh();
  }

  return (
    <div className="max-w-[720px] mx-auto space-y-5">
      <div>
        <h1 className="text-[20px] font-semibold text-[#1c1a17]">Notes</h1>
        <p className="text-[13px] text-[#9c968d] mt-0.5">Your private, dated notes — jot anything down.</p>
      </div>

      {/* Add box — optional recall name + raw string body. */}
      <div className="bg-white rounded-2xl border border-[#ece8e1] p-4 space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Name (optional) — e.g. SLA discussion with Lead"
          className="w-full rounded-lg border border-[#ece8e1] px-3 py-2 text-sm font-medium text-[#2c2925] outline-none focus:border-primary"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") add();
          }}
          rows={3}
          placeholder="Write a note…"
          className="w-full resize-none rounded-lg border border-[#ece8e1] px-3 py-2 text-sm text-[#2c2925] outline-none focus:border-primary"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-[#b0a99e]">{error ?? "⌘/Ctrl + Enter to save"}</span>
          <button
            onClick={add}
            disabled={busy || !body.trim()}
            className="text-sm font-semibold rounded-lg bg-primary text-white px-4 py-1.5 disabled:opacity-40 transition-opacity"
          >
            {busy ? "Saving…" : "Add note"}
          </button>
        </div>
      </div>

      {/* Date-grouped feed. */}
      {groups.length === 0 ? (
        <p className="text-sm text-[#b0a99e] text-center py-8">No notes yet.</p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="text-xs font-semibold text-[#9c968d] mb-2">{formatDate(g.day)}</div>
              <div className="space-y-2">
                {g.notes.map((n) => (
                  <div key={n.id} className="group bg-white rounded-xl border border-[#ece8e1] px-4 py-3 flex gap-3">
                    <span className="text-[11px] text-[#b0a99e] shrink-0 mt-0.5 mono">{timeLabel(n.createdAt)}</span>
                    {n.done !== null && editId !== n.id && (
                      <input
                        type="checkbox"
                        checked={n.done}
                        onChange={(e) => toggle(n.id, e.target.checked)}
                        className="accent-primary mt-0.5 shrink-0 cursor-pointer"
                      />
                    )}
                    {editId === n.id ? (
                      <div className="flex-1 min-w-0 space-y-2">
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Name (optional)"
                          className="w-full rounded-lg border border-[#ece8e1] px-3 py-1.5 text-sm font-medium text-[#2c2925] outline-none focus:border-primary"
                        />
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveEdit(n.id);
                            else if (e.key === "Escape") setEditId(null);
                          }}
                          rows={3}
                          className="w-full resize-none rounded-lg border border-[#ece8e1] px-3 py-1.5 text-sm text-[#2c2925] outline-none focus:border-primary"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => saveEdit(n.id)}
                            disabled={!editBody.trim()}
                            className="text-xs font-semibold rounded-lg bg-primary text-white px-3 py-1 disabled:opacity-40"
                          >
                            Save
                          </button>
                          <button onClick={() => setEditId(null)} className="text-xs text-[#9c968d] px-2 py-1">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        {n.title && <div className={`text-sm font-semibold mb-0.5 ${n.done ? "line-through text-[#b0a99e]" : "text-[#1c1a17]"}`}>{n.title}</div>}
                        <p className={`text-sm whitespace-pre-wrap break-words ${n.done ? "line-through text-[#b0a99e]" : "text-[#2c2925]"}`}>{n.body}</p>
                      </div>
                    )}
                    {editId !== n.id && (
                      <button
                        onClick={() => startEdit(n)}
                        className="text-[11px] text-[#b0a99e] hover:text-primary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
