"use client";

import { cn } from "@/lib/utils";
import { fmtHours, planningAccuracy } from "@/lib/task-status";
import type { CategorySlice } from "@/lib/insights";

type DayPoint = { date: string; planned: number; worked: number };

// Category palette per the mockup — stable by slice order.
const CAT_COLORS = ["#3a6ea5", "#6a5acd", "#2f8f83", "#c08a2d", "#d6608a", "#8b5cc4", "#3f8a5b", "#6b665f"];

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
    <div className="max-w-[1080px] mx-auto space-y-4">
      {/* Identity header */}
      <div className="bg-white rounded-2xl border border-[#ece8e1] p-[22px] flex items-center gap-4">
        <span className="w-[52px] h-[52px] rounded-[14px] bg-[#fdeee9] text-[#e0533a] inline-flex items-center justify-center text-[20px] font-semibold">
          {initial}
        </span>
        <div className="min-w-0">
          <div className="text-[20px] font-semibold text-[#1c1a17] truncate">{user.name || user.email}</div>
          <div className="text-[13px] text-[#9c968d] truncate">
            {user.email} · <span className={user.role === "ADMIN" ? "text-[#c08a2d] font-semibold" : "font-semibold"}>{user.role}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="14-day completion" value={`${stats.completionRate}%`} color="#3f8a5b" />
        <StatCard label="Done all-time" value={String(stats.doneAllTime)} color="#1c1a17" />
      </div>

      {/* Daily work hours vs planning — planned (estimate) against worked (actual)
          effort per day over the trailing week, so estimation drift is visible. */}
      <WorkHoursChart daily={daily} />

      {/* Where your time goes — your own effort split by category over the window. */}
      <CategoryBreakdown categories={categories} />

      {/* Planning accuracy — 14-day estimate-vs-actual trend over completed work.
          Admin-only for now: members don't see their own estimation variance. */}
      {user.role === "ADMIN" && (
        <div className="bg-white rounded-2xl border border-[#ece8e1] p-[22px]">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#1c1a17]">Planning accuracy</div>
              <p className="text-xs text-[#9c968d] mt-[5px]">How close your estimates ran to reality over the last 14 days.</p>
            </div>
            {accuracy.tone !== "none" && (
              <span
                className={cn(
                  "text-[11px] font-semibold rounded-md px-[10px] py-[5px] shrink-0",
                  accuracy.tone === "under"
                    ? "text-[#c0392b] bg-[#fbe4de]"
                    : accuracy.tone === "over"
                    ? "text-[#c08a2d] bg-[#fdf7ec]"
                    : "text-[#357a4f] bg-[#e9f4ec]",
                )}
              >
                {accuracy.tone === "under" && "⚠ "}
                {accuracy.label}
              </span>
            )}
          </div>
          {accuracy.tone === "none" ? (
            <p className="text-sm text-[#b0a99e]">No completed tasks with logged effort in the last 14 days yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4">
                <MiniStat label="Estimated" value={fmtHours(stats.estDone14)} />
                <MiniStat label="Actual" value={fmtHours(stats.actDone14)} />
                <MiniStat
                  label="Of estimate"
                  value={accuracy.pct !== null ? `${accuracy.pct}%` : "—"}
                  bg="#fdeee9"
                  valueColor={accuracy.tone === "under" ? "#c0392b" : "#1c1a17"}
                />
              </div>
              <p className="text-xs text-[#9c968d] mt-4">
                {accuracy.tone === "under"
                  ? "You consistently plan lighter than reality — work runs longer than estimated. Try padding those estimates or logging what makes them run long."
                  : accuracy.tone === "over"
                  ? "You tend to budget more time than tasks take. Trimming estimates would give a truer picture of your capacity."
                  : "Your estimates are tracking reality closely — keep it up."}
              </p>
            </>
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
  const todayKey = daily.length ? daily[daily.length - 1].date : "";

  return (
    <div className="bg-white rounded-2xl border border-[#ece8e1] p-[22px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#1c1a17]">Work hours vs planning</div>
          <p className="text-xs text-[#9c968d] mt-[5px]">Planned effort against what you actually worked, day by day.</p>
        </div>
        <div className="flex items-center gap-[14px] shrink-0 text-xs text-[#6b665f]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-[9px] h-[9px] rounded-sm bg-[#c7c0b6]" /> Planned
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-[9px] h-[9px] rounded-sm bg-[#e0533a]" /> Worked
          </span>
        </div>
      </div>

      {!hasData ? (
        <p className="text-sm text-[#b0a99e] mt-4">No estimated or logged hours in the last week yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(7,1fr)] gap-[10px] items-end mt-5">
            {daily.map((d) => (
              <div key={d.date} className="flex flex-col items-center gap-2">
                <div className="flex items-end justify-center gap-1 h-[120px]">
                  <Bar value={d.planned} max={max} color="#c7c0b6" empty="#eee9e1" label="Planned" />
                  <Bar value={d.worked} max={max} color="#e0533a" empty="#eee9e1" label="Worked" />
                </div>
                <span
                  className={cn(
                    "text-[11px]",
                    d.date === todayKey ? "text-[#e0533a] font-semibold" : "text-[#b0a99e]",
                  )}
                >
                  {dayLabel(d.date)}
                </span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 mt-5">
            <MiniStat label="Planned (7d)" value={fmtHours(totalPlanned)} />
            <MiniStat label="Worked (7d)" value={fmtHours(totalWorked)} />
          </div>
        </>
      )}
    </div>
  );
}

function Bar({ value, max, color, empty, label }: { value: number; max: number; color: string; empty: string; label: string }) {
  // Give a non-zero value a visible minimum so a small bar doesn't vanish; a
  // zero value shows a faint stub so the column reads as "planned nothing".
  const pct = value === 0 ? 0 : Math.max(2, (value / max) * 100);
  return (
    <div
      className="w-[14px] rounded-t-[3px] transition-all"
      style={{ height: `${pct}%`, minHeight: 2, backgroundColor: value === 0 ? empty : color }}
      title={`${label}: ${fmtHours(value)}`}
    />
  );
}

// "Mon", "Tue"… for a YYYY-MM-DD key. Format in UTC to match the stored day.
function dayLabel(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
}

// Effort-by-category — stacked segment bar + two-column legend, styled to match
// the mockup (mono numbers, mockup palette). Profile-local so tweaking it here
// doesn't ripple into the shared Insights card.
function CategoryBreakdown({ categories }: { categories: CategorySlice[] }) {
  const totalHours = categories.reduce((s, c) => s + c.hours, 0);
  return (
    <div className="bg-white rounded-2xl border border-[#ece8e1] p-[22px]">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
        <span className="text-sm font-semibold text-[#1c1a17]">Where your time goes</span>
        <span className="text-xs text-[#b0a99e]">effort by category · {fmtHours(totalHours)} logged</span>
      </div>

      {categories.length === 0 ? (
        <p className="text-sm text-[#b0a99e]">
          No categorized effort yet. Tag tasks (meetings, client calls, cross-team, R&D…) to see the split.
        </p>
      ) : (
        <>
          <div className="flex h-[14px] rounded-[7px] overflow-hidden mb-[18px]">
            {categories.map((c, i) => (
              <div
                key={c.id ?? "none"}
                style={{ width: `${c.pct}%`, backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }}
                title={`${c.name}: ${fmtHours(c.hours)} (${c.pct}%)`}
              />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-[10px] gap-x-10">
            {categories.map((c, i) => (
              <div key={c.id ?? "none"} className="flex items-center gap-[9px] text-[13px]">
                <span className="w-[9px] h-[9px] rounded-sm shrink-0" style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />
                <span className={cn("truncate", c.id ? "text-[#1c1a17]" : "text-[#9c968d] italic")}>{c.name}</span>
                <span className="mono ml-auto text-[#1c1a17]">{fmtHours(c.hours)}</span>
                <span className="mono w-10 text-right text-[#b0a99e]">{c.pct}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#ece8e1] px-[22px] py-5">
      <div className="text-[13px] text-[#9c968d]">{label}</div>
      <div className="mono text-[32px] font-semibold mt-1" style={{ color }}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, bg = "#f6f4f1", valueColor = "#1c1a17" }: { label: string; value: string; bg?: string; valueColor?: string }) {
  return (
    <div className="rounded-xl p-4 text-center" style={{ backgroundColor: bg }}>
      <div className="text-xs text-[#9c968d]">{label}</div>
      <div className="mono text-2xl font-semibold mt-[3px]" style={{ color: valueColor }}>{value}</div>
    </div>
  );
}
