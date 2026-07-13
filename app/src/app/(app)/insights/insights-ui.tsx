"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fmtHours, type PlanningTone } from "@/lib/task-status";
import type { BlockedDependency, CategorySlice, TrendPoint } from "@/lib/insights";

// Rotating palette for the category bars — matches the design mockup so a
// category reads distinct without competing with the coral leak accents.
export const CAT_COLORS = ["#6a5acd", "#3a6ea5", "#2f8f83", "#c08a2d", "#d6608a", "#8b5cc4", "#3f8a5b", "#6b665f", "#4a5ac0"];

// Tone → colour for estimate drift. Underestimation is the leak to watch (work
// runs longer than planned), so it reads red; overestimation is amber-neutral.
export const TONE: Record<PlanningTone, { color: string; alert: boolean }> = {
  ok: { color: "#3f8a5b", alert: false },
  under: { color: "#c0392b", alert: true },
  over: { color: "#c08a2d", alert: false },
  none: { color: "#b0a99e", alert: false },
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
    <div className={cn("bg-white rounded-[14px] border p-[15px]", alert ? "border-[#f6cabc]" : "border-[#ece8e1]")}>
      <p className="text-xs text-[#9c968d] truncate">{label}</p>
      <div className="flex items-end justify-between gap-2 my-[5px]">
        <p className="mono text-[24px] font-semibold leading-none" style={{ color: accent }}>{value}</p>
        {trend && <Sparkline points={trend} color={trendColor ?? accent} />}
      </div>
      {hint && <p className="text-[10px] text-[#b0a99e] mt-1.5 truncate" title={hint}>{hint}</p>}
    </div>
  );
}

// Cross-team dependency leak — who/which team the team keeps waiting on. This is
// the leak a task tracker usually can't see; the HOLD-reason capture makes it
// visible. Rendered as a ranked list with the most recent "why" for context.
export function BlockedList({ blocked, emptyHint }: { blocked: BlockedDependency[]; emptyHint: string }) {
  return (
    <div className="bg-white rounded-[16px] border border-[#ece8e1] px-[22px] py-[18px] mb-[22px] flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3.5 flex-wrap min-w-0">
        <span className="text-sm font-semibold text-[#1c1a17] shrink-0">Waiting on</span>
        {blocked.length === 0 ? (
          <span className="text-sm text-[#b0a99e]">{emptyHint}</span>
        ) : (
          blocked.map((b) => (
            <span
              key={b.blockedOn.toLowerCase()}
              className="inline-flex items-center gap-1.5 bg-[#eae6fb] text-[#6a5acd] rounded-md px-2.5 py-1 text-[11px] font-semibold"
              title={b.lastReason ?? undefined}
            >
              {b.lastReason ? b.lastReason : b.blockedOn}
              <span className="mono">×{b.count}</span>
            </span>
          ))
        )}
      </div>
      <span className="text-xs text-[#b0a99e] shrink-0">cross-team dependencies from HOLD reasons</span>
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

// Effort-by-category, broken out per person. Narrow right-rail panel: one
// clickable line per member (name + thin category bar). Clicking opens a side
// drawer with the full breakdown, so the panel stays compact even at ~50 people.
export function CategoryByPerson({
  members,
  colorOf,
}: {
  members: { id: string; name: string; categories: CategorySlice[] }[];
  colorOf: (id: string | null) => string;
}) {
  const withData = members.filter((m) => m.categories.length > 0);
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = withData.find((m) => m.id === openId) ?? null;

  return (
    <div className="bg-white rounded-[16px] border border-[#ece8e1] p-[18px] sticky top-[18px]">
      <h2 className="text-sm font-semibold text-[#1c1a17]">Where time goes · by person</h2>
      <p className="text-xs text-[#b0a99e] mt-1 mb-3.5">Click a person for the full breakdown</p>
      {withData.length === 0 ? (
        <p className="text-sm text-[#b0a99e] py-2">
          No categorized effort yet. Tag tasks (meetings, client calls, cross-team, R&D…) to see the split per person.
        </p>
      ) : (
        <div className="divide-y divide-[#f2eee7] max-h-[80vh] overflow-auto -mx-[18px] px-[18px]">
          {withData.map((m) => {
            const total = m.categories.reduce((s, c) => s + c.hours, 0);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setOpenId(m.id)}
                className="w-full text-left py-2.5 first:pt-0 group focus:outline-none"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <span className="text-sm font-medium text-[#2c2925] truncate group-hover:text-primary">{m.name}</span>
                  <span className="mono text-xs text-[#b0a99e] shrink-0">{fmtHours(total)}</span>
                </div>
                <div className="flex h-2 rounded-full overflow-hidden">
                  {m.categories.map((c) => (
                    <div
                      key={c.id ?? "none"}
                      style={{ width: `${c.pct}%`, backgroundColor: colorOf(c.id) }}
                      title={`${c.name}: ${fmtHours(c.hours)} (${c.pct}%)`}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && <PersonDrawer member={selected} colorOf={colorOf} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// Right side drawer with one member's full category breakdown (bar + hours/pct
// legend). Backdrop click or Escape closes.
function PersonDrawer({
  member,
  colorOf,
  onClose,
}: {
  member: { id: string; name: string; categories: CategorySlice[] };
  colorOf: (id: string | null) => string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = member.categories.reduce((s, c) => s + c.hours, 0);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${member.name} — where time goes`}>
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[420px] bg-white shadow-2xl border-l border-[#ece8e1] flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-[#ece8e1]">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[#1c1a17] truncate">{member.name}</h3>
            <p className="text-xs text-[#b0a99e] mt-0.5">Where time goes · <span className="mono">{fmtHours(total)}</span> total</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[#b0a99e] hover:text-[#1c1a17] text-2xl leading-none shrink-0"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5 overflow-auto">
          <div className="flex h-3.5 rounded-[7px] overflow-hidden mb-5">
            {member.categories.map((c) => (
              <div
                key={c.id ?? "none"}
                style={{ width: `${c.pct}%`, backgroundColor: colorOf(c.id) }}
                title={`${c.name}: ${fmtHours(c.hours)} (${c.pct}%)`}
              />
            ))}
          </div>
          <div className="space-y-2.5">
            {member.categories.map((c) => (
              <div key={c.id ?? "none"} className="flex items-center gap-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colorOf(c.id) }} />
                <span className={cn("flex-1 truncate", c.id ? "text-[#1c1a17]" : "text-[#b0a99e] italic")}>{c.name}</span>
                <span className="mono text-[#1c1a17] shrink-0">{fmtHours(c.hours)}</span>
                <span className="mono text-xs text-[#b0a99e] shrink-0 w-10 text-right">{c.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CategoryBreakdown({ categories, title = "Where time goes" }: { categories: CategorySlice[]; title?: string }) {
  const totalHours = categories.reduce((s, c) => s + c.hours, 0);
  return (
    <div className="bg-white rounded-[16px] border border-[#ece8e1] p-[22px] mb-[22px]">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
        <h2 className="text-sm font-semibold text-[#1c1a17]">{title}</h2>
        <p className="text-xs text-[#b0a99e]">effort by category · <span className="mono">{fmtHours(totalHours)}</span> logged/planned</p>
      </div>

      {categories.length === 0 ? (
        <p className="text-sm text-[#b0a99e] py-2">
          No categorized effort yet. Tag tasks (meetings, client calls, cross-team, R&D…) to see the split.
        </p>
      ) : (
        <>
          <div className="flex h-3.5 rounded-[7px] overflow-hidden mb-[18px]">
            {categories.map((c, i) => (
              <div
                key={c.id ?? "none"}
                style={{ width: `${c.pct}%`, backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }}
                title={`${c.name}: ${fmtHours(c.hours)} (${c.pct}%)`}
              />
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-x-10 gap-y-2.5">
            {categories.map((c, i) => (
              <div key={c.id ?? "none"} className="flex items-center gap-[9px] text-[13px]">
                <span className="w-[9px] h-[9px] rounded-sm shrink-0" style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />
                <span className={cn("truncate", c.id ? "text-[#1c1a17]" : "text-[#9c968d] italic")}>{c.name}</span>
                <span className="mono ml-auto text-[#1c1a17] shrink-0">{fmtHours(c.hours)}</span>
                <span className="mono text-[#b0a99e] shrink-0 w-10 text-right">{c.pct}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
