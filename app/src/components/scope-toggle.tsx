"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

// Two-way audience switch for Team / Insights: "My team" (only people who report
// to the current manager — members of teams they manage) vs "Organization"
// (everyone). Writes ?scope=team|org to the URL, preserving other params, so the
// server page re-fetches scoped. Default scope is role-based on the server, so an
// absent param still lands somewhere sensible.
export type Scope = "team" | "org";

export function ScopeToggle({ current }: { current: Scope }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(scope: Scope) {
    if (scope === current) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("scope", scope);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-0.5 bg-white border border-[#ece8e1] rounded-[10px] p-[3px]">
      {([
        ["team", "My team"],
        ["org", "Organization"],
      ] as const).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => select(key)}
          aria-pressed={current === key}
          className={cn(
            "text-xs px-[11px] py-1.5 rounded-[7px] transition-colors",
            current === key
              ? "bg-primary text-white font-semibold"
              : "text-[#9c968d] hover:text-[#6b665f]",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
