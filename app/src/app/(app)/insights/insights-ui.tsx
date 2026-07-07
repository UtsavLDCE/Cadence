"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { fmtHours, type PlanningTone } from "@/lib/task-status";
import type { BlockedDependency, CategorySlice, TrendPoint } from "@/lib/insights";

// Rotating palette for the category bars — indigo-leaning so it reads distinct
// from the coral leak accents without competing with them.
export const CAT_COLORS = ["#6366f1", "#0ea5e9", "#14b8a6", "#f59e0b", "#ec4899", "#8b5cf6", "#22c55e", "#64748b"];

// Tone → colour for estimate drift. Underestimation is the leak to watch (work
// runs longer than planned), so it reads coral; overestimation is amber-neutral.
export const TONE: Record<PlanningTone, { color: string; alert: boolean }> = {
  ok: { color: "#2bb673", alert: false },
  under: { color: "#f4502e", alert: true },
  over: { color: "#f5a623", alert: false },
  none: { color: "#8a93a6", alert: false },
};

// Tiny inline sparkline. Draws the non-null points of a trend series, connecting
// across gaps, normalized to the series' own min/max so shape (direction) reads
// even when absolute values are small. A single point renders as a dot; an empty
// series renders nothing.
export function Sparkline({
  points,
  color = "#6b7280",
  width = 72,
  height = 22,
}: {
  points: TrendPoint[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const pts = points
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length === 0) return null;

  const n = points.length;
  const xs = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * (width - 2) + 1);
  const vals = pts.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const ys = (v: number) => height - 2 - ((v - min) / span) * (height - 4);

  const coords = pts.map((p) => ({ x: xs(p.i), y: ys(p.v) }));
  const last = coords[coords.length - 1];

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      {coords.length > 1 && (
        <polyline
          points={coords.map((c) => `${c.x},${c.y}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <circle cx={last.x} cy={last.y} r={2} fill={color} />
    </svg>
  );
}

export function Stat({
  label,
  value,
  accent,
  hint,
  alert,
  trend,
  trendColor,
}: {
  label: string;
  value: string;
  accent: string;
  hint?: string;
  alert?: boolean;
  trend?: TrendPoint[];
  trendColor?: string;
}) {
  return (
    <div className={cn("bg-white rounded-xl border p-4", alert ? "border-[#f6cabc]" : "border-gray-200")}>
      <p className="text-xs text-gray-500 truncate">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <p className="text-2xl font-bold mt-1 leading-tight" style={{ color: accent }}>{value}</p>
        {trend && <Sparkline points={trend} color={trendColor ?? accent} />}
      </div>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5 truncate" title={hint}>{hint}</p>}
    </div>
  );
}

// Cross-team dependency leak — who/which team the team keeps waiting on. This is
// the leak a task tracker usually can't see; the HOLD-reason capture makes it
// visible. Rendered as a ranked list with the most recent "why" for context.
export function BlockedList({ blocked, emptyHint }: { blocked: BlockedDependency[]; emptyHint: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
        <h2 className="font-semibold text-gray-800">Waiting on</h2>
        <p className="text-xs text-gray-400">Cross-team dependencies from HOLD reasons</p>
      </div>
      {blocked.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">{emptyHint}</p>
      ) : (
        <ul className="space-y-2">
          {blocked.map((b) => (
            <li key={b.blockedOn.toLowerCase()} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 shrink-0 inline-flex items-center gap-1.5 bg-violet-100 text-violet-700 rounded-full px-2.5 py-0.5 text-xs font-medium">
                {b.blockedOn}
                <span className="tabular-nums text-violet-500">×{b.count}</span>
              </span>
              {b.lastReason && (
                <span className="text-gray-500 flex-1 min-w-0 truncate" title={b.lastReason}>
                  {b.lastReason}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A per-category colour that stays stable across every chart on the page: the
// team-level slice order defines the palette so a category reads the same colour
// in the aggregate bar and in each person's bar. Falls back to grey for a
// category that somehow isn't in the reference set.
export function buildCategoryColors(reference: CategorySlice[]): (id: string | null) => string {
  const map = new Map<string, string>();
  reference.forEach((c, i) => map.set(c.id ?? "none", CAT_COLORS[i % CAT_COLORS.length]));
  return (id) => map.get(id ?? "none") ?? "#94a3b8";
}

// Effort-by-category, broken out per person. Uses the shared colourOf so a
// category keeps its colour across the team bar and every member's row. Each
// person's row expands to a fuller breakdown (hours + pct per category).
export function CategoryByPerson({
  members,
  colorOf,
}: {
  members: { id: string; name: string; categories: CategorySlice[] }[];
  colorOf: (id: string | null) => string;
}) {
  const withData = members.filter((m) => m.categories.length > 0);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
        <h2 className="font-semibold text-gray-800">Where time goes · by person</h2>
        <p className="text-xs text-gray-400">Same categories, split per member · click a person for the full breakdown</p>
      </div>
      {withData.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">
          No categorized effort yet. Tag tasks (meetings, client calls, cross-team, R&D…) to see the split per person.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {withData.map((m) => (
            <PersonCategoryRow key={m.id} member={m} colorOf={colorOf} />
          ))}
        </div>
      )}
    </div>
  );
}

// One member's category split. Collapsed: bar + compact pct chips. Expanded:
// a detailed legend carrying hours alongside pct, matching the team-level card.
function PersonCategoryRow({
  member,
  colorOf,
}: {
  member: { id: string; name: string; categories: CategorySlice[] };
  colorOf: (id: string | null) => string;
}) {
  const [open, setOpen] = useState(false);
  const total = member.categories.reduce((s, c) => s + c.hours, 0);
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left group focus:outline-none"
      >
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <span className="text-sm font-medium text-gray-800 truncate flex items-center gap-1.5 min-w-0">
            <svg
              viewBox="0 0 20 20"
              className={cn("w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform", open && "rotate-90")}
              fill="currentColor"
              aria-hidden
            >
              <path d="M7 5l6 5-6 5V5z" />
            </svg>
            <span className="truncate">{member.name}</span>
          </span>
          <span className="text-xs text-gray-400 shrink-0 tabular-nums">{fmtHours(total)}</span>
        </div>
        <div className="flex h-2.5 rounded-full overflow-hidden">
          {member.categories.map((c) => (
            <div
              key={c.id ?? "none"}
              style={{ width: `${c.pct}%`, backgroundColor: colorOf(c.id) }}
              title={`${c.name}: ${fmtHours(c.hours)} (${c.pct}%)`}
            />
          ))}
        </div>
      </button>

      {open ? (
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 mt-3">
          {member.categories.map((c) => (
            <div key={c.id ?? "none"} className="flex items-center gap-2 text-sm">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colorOf(c.id) }} />
              <span className={cn("flex-1 truncate", c.id ? "text-gray-700" : "text-gray-400 italic")}>{c.name}</span>
              <span className="text-gray-500 tabular-nums shrink-0">{fmtHours(c.hours)}</span>
              <span className="text-xs text-gray-400 tabular-nums shrink-0 w-9 text-right">{c.pct}%</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
          {member.categories.map((c) => (
            <span key={c.id ?? "none"} className="inline-flex items-center gap-1.5 text-xs">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: colorOf(c.id) }} />
              <span className={cn(c.id ? "text-gray-600" : "text-gray-400 italic")}>{c.name}</span>
              <span className="text-gray-400 tabular-nums">{c.pct}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function CategoryBreakdown({ categories, title = "Where time goes" }: { categories: CategorySlice[]; title?: string }) {
  const totalHours = categories.reduce((s, c) => s + c.hours, 0);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
        <h2 className="font-semibold text-gray-800">{title}</h2>
        <p className="text-xs text-gray-400">Effort by category · {fmtHours(totalHours)} logged/planned</p>
      </div>

      {categories.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">
          No categorized effort yet. Tag tasks (meetings, client calls, cross-team, R&D…) to see the split.
        </p>
      ) : (
        <>
          <div className="flex h-3 rounded-full overflow-hidden mb-4">
            {categories.map((c, i) => (
              <div
                key={c.id ?? "none"}
                style={{ width: `${c.pct}%`, backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }}
                title={`${c.name}: ${fmtHours(c.hours)} (${c.pct}%)`}
              />
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
            {categories.map((c, i) => (
              <div key={c.id ?? "none"} className="flex items-center gap-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />
                <span className={cn("flex-1 truncate", c.id ? "text-gray-700" : "text-gray-400 italic")}>{c.name}</span>
                <span className="text-gray-500 tabular-nums shrink-0">{fmtHours(c.hours)}</span>
                <span className="text-xs text-gray-400 tabular-nums shrink-0 w-9 text-right">{c.pct}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
