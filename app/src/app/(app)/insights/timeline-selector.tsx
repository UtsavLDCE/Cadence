"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, type RangeKey } from "@/lib/insights-range";

// Timeline picker for the Insights page. Presets and a custom from/to span are
// written to the URL (?range=…&from=…&to=…); the server page reads them, so a
// selection is shareable and survives reload. Navigating triggers a server
// re-fetch scoped to the chosen window.
export function TimelineSelector({
  current,
  from,
  to,
}: {
  current: RangeKey;
  from: string; // YYYY-MM-DD of the resolved start (seeds the custom pickers)
  to: string; // YYYY-MM-DD of the resolved end
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [showCustom, setShowCustom] = useState(current === "custom");
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);

  function selectPreset(key: RangeKey) {
    setShowCustom(false);
    router.push(`${pathname}?range=${key}`);
  }

  function applyCustom() {
    if (!customFrom || !customTo) return;
    const params = new URLSearchParams({ range: "custom", from: customFrom, to: customTo });
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => selectPreset(p.key)}
            aria-pressed={current === p.key}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              current === p.key
                ? "bg-primary text-white border-primary"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300",
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustom((v) => !v)}
          aria-pressed={current === "custom"}
          aria-expanded={showCustom}
          className={cn(
            "text-xs px-2.5 py-1 rounded-full border transition-colors",
            current === "custom"
              ? "bg-primary text-white border-primary"
              : "bg-white text-gray-600 border-gray-200 hover:border-gray-300",
          )}
        >
          Custom{current === "custom" ? ` · ${from} → ${to}` : ""}
        </button>
      </div>

      {showCustom && (
        <div className="flex flex-wrap items-end gap-2 bg-white border border-gray-200 rounded-lg p-3">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            From
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#f4502e55]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            To
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#f4502e55]"
            />
          </label>
          <button
            type="button"
            onClick={applyCustom}
            disabled={!customFrom || !customTo}
            className="text-sm px-3 py-1.5 rounded-lg bg-primary text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
