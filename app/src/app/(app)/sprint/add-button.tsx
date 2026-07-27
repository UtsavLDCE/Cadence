"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Adds a sprint item onto today's plan as a planned DailyTask. Reuses the normal
// POST /api/tasks path (estimate required, blocked once the day is submitted) —
// the server enforces those rules, we just surface the error.
export function AddToToday({
  title,
  estimatedHours,
  externalId,
}: {
  title: string;
  estimatedHours: number;
  externalId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  async function add() {
    setState("saving");
    setErr("");
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, estimatedHours, notes: `Sprint #${externalId}` }),
    });
    if (res.ok) {
      setState("done");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Failed to add.");
      setState("error");
    }
  }

  if (state === "done") return <span className="text-xs text-green-600 font-medium">Added ✓</span>;

  return (
    <button
      onClick={add}
      disabled={state === "saving"}
      title={err || "Add to today's plan"}
      className="text-xs px-2.5 py-1 rounded-md border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
    >
      {state === "saving" ? "…" : state === "error" ? "Retry" : "+ Today"}
    </button>
  );
}
