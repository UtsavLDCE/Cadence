"use client";

import { cn } from "@/lib/utils";
import { fmtHours, planningAccuracy } from "@/lib/task-status";
import type { CategorySlice } from "@/lib/insights";
import { CategoryBreakdown } from "../insights/insights-ui";

type DayPoint = { date: string; planned: number; worked: number };

type Props = {
  user: { name: string | null; email: string | null; role: string };
  daily: DayPoint[];
  categories: CategorySlice[];
  stats: {
    completionRate: number;
    completed14: number;
    planned14: number;
    doneAllTime: number;
    estDone14: number;
    actDone14: number;
  };
};

export function ProfileClient({ user, daily, categories, stats }: Props) {
  // 14-day planning accuracy — how close estimates ran to actuals on done work.
  const accuracy = planningAccuracy(stats.estDone14, stats.actDone14);

  const initial = (user.name || user.email || "?")[0].toUpperCase();

  return (
    <div className="space-y-6">
      {/* Identity header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary-soft text-primary flex items-center justify-center text-2xl font-bold">
          {initial}
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{user.name || user.email}</h1>
          <p className="text-sm text-gray-500">{user.email} · {user.role}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="14-day completion" value={`${stats.completionRate}%`} tone="ok" />
        <StatCard label="Done all-time" value={String(stats.doneAllTime)} tone="muted" />
      </div>

      {/* Daily work hours vs planning — planned (estimate) against worked (actual)
          effort per day over the trailing week, so estimation drift is visible. */}
      <WorkHoursChart daily={daily} />

      {/* Where your time goes — your own effort split by category over the window. */}
      <CategoryBreakdown categories={categories} title="Where your time goes" />

      {/* Planning accuracy — 14-day estimate-vs-actual trend over completed work.
          Admin-only for now: members don't see their own estimation variance. */}
      {user.role === "ADMIN" && (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Planning accuracy</h2>
            <p className="text-sm text-gray-500 mt-0.5">How close your estimates ran to reality over the last 14 days.</p>
          </div>
          {accuracy.tone !== "none" && (
            <span
              className={cn(
                "text-xs font-medium rounded px-2 py-0.5 shrink-0",
                accuracy.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
              )}
            >
              {accuracy.tone === "under" && "⚠ "}
              {accuracy.label}
            </span>
          )}
        </div>
        {accuracy.tone === "none" ? (
          <p className="text-sm text-gray-400 mt-3">
            No completed tasks with logged effort in the last 14 days yet.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 mt-4">
            <MiniStat label="Estimated" value={fmtHours(stats.estDone14)} />
            <MiniStat label="Actual" value={fmtHours(stats.actDone14)} />
            <MiniStat label="Of estimate" value={accuracy.pct !== null ? `${accuracy.pct}%` : "—"} />
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// Grouped bar chart: for each day, a "planned" (estimated) bar beside a "worked"
// (actual) bar. Pure CSS/flex — bars are scaled to the largest value in view so
// the tallest day fills the plot. Days with no work render as an empty column.
function WorkHoursChart({ daily }: { daily: DayPoint[] }) {
  const max = Math.max(1, ...daily.map((d) => Math.max(d.planned, d.worked)));
  const totalPlanned = daily.reduce((s, d) => s + d.planned, 0);
  const totalWorked = daily.reduce((s, d) => s + d.worked, 0);
  const hasData = totalPlanned > 0 || totalWorked > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-gray-900">Work hours vs planning</h2>
          <p className="text-sm text-gray-500 mt-0.5">Planned effort against what you actually worked, day by day.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-gray-300" /> Planned
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-primary" /> Worked
          </span>
        </div>
      </div>

      {!hasData ? (
        <p className="text-sm text-gray-400 mt-4">No estimated or logged hours in the last week yet.</p>
      ) : (
        <>
          <div className="mt-5 flex items-end justify-between gap-2 h-40">
            {daily.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div className="flex items-end justify-center gap-1 w-full h-full">
                  <Bar value={d.planned} max={max} color="bg-gray-300" label="Planned" />
                  <Bar value={d.worked} max={max} color="bg-primary" label="Worked" />
                </div>
                <span className="text-[11px] text-gray-400 tabular-nums">{dayLabel(d.date)}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <MiniStat label="Planned (7d)" value={fmtHours(totalPlanned)} />
            <MiniStat label="Worked (7d)" value={fmtHours(totalWorked)} />
          </div>
        </>
      )}
    </div>
  );
}

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  // Give a non-zero value a visible minimum so a small bar doesn't vanish.
  const pct = value === 0 ? 0 : Math.max(4, (value / max) * 100);
  return (
    <div
      className={cn("w-3 sm:w-4 rounded-t transition-all", color)}
      style={{ height: `${pct}%` }}
      title={`${label}: ${fmtHours(value)}`}
    />
  );
}

// "Mon", "Tue"… for a YYYY-MM-DD key. Format in UTC to match the stored day.
function dayLabel(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "danger" | "warn" | "ok" | "muted" }) {
  const color =
    tone === "danger" ? "text-primary" : tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "text-gray-900";
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={cn("text-2xl font-bold mt-0.5", color)}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900 mt-0.5">{value}</p>
    </div>
  );
}
