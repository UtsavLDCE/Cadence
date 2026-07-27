"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Add/remove a sprint item on today's plan. Adding POSTs a planned DailyTask
// (marked "Sprint #<id>" so the page can tell it's already on today); removing
// DELETEs that task. Both reuse the normal /api/tasks routes, which enforce the
// day-lock — but the page also hides the controls once the day is submitted.
// The task lands on today's plan, so My Day / today's goal reflect it immediately.
export function AddToToday({
  title,
  estimatedHours,
  externalId,
  prReview = false,
  taskId = null,
  submitted = false,
  canAdd = true,
}: {
  title: string;
  estimatedHours: number;
  externalId: string;
  // When adding from the manager's "Pending In Review" queue, the task is a review
  // pass over a report's work — prefix the title and file it under a "PR Review"
  // category so it's distinct from the manager's own planned work.
  prReview?: boolean;
  // The today task this item is already on, if any. Present -> show Remove.
  taskId?: string | null;
  // Today's plan is submitted -> no add/remove (the day is locked).
  submitted?: boolean;
  // Whether adding is offered (item is actionable). Ignored once already added.
  canAdd?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function add() {
    setBusy(true);
    setErr("");
    // For a PR-review add, ensure the "PR Review" category exists (idempotent
    // get-or-create) so the task can be filed under it.
    let categoryId: string | undefined;
    if (prReview) {
      const catRes = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "PR Review" }),
      });
      if (!catRes.ok) {
        setErr("Failed to set category.");
        setBusy(false);
        return;
      }
      categoryId = (await catRes.json()).id;
    }
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: prReview ? `PR Review: ${title}` : title,
        estimatedHours,
        categoryId,
        notes: `Sprint #${externalId}`,
      }),
    });
    if (res.ok) router.refresh();
    else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Failed to add.");
    }
    setBusy(false);
  }

  async function remove() {
    if (!taskId) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Failed to remove.");
    }
    setBusy(false);
  }

  if (taskId) {
    return (
      <span className="inline-flex items-center gap-2 justify-end">
        <span className="text-xs text-green-600 font-medium">Added ✓</span>
        {!submitted && (
          <button
            onClick={remove}
            disabled={busy}
            title={err || "Remove from today's plan"}
            className="text-xs px-2 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {busy ? "…" : "Remove"}
          </button>
        )}
      </span>
    );
  }

  // Not added: offer Add only while the day is open and the item is actionable.
  if (submitted || !canAdd) return null;

  return (
    <button
      onClick={add}
      disabled={busy}
      title={err || "Add to today's plan"}
      className="text-xs px-2.5 py-1 rounded-md border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
    >
      {busy ? "…" : err ? "Retry" : "+ Today"}
    </button>
  );
}
