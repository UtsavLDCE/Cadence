"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Count of pending shared-work invites, so "My Day" shows an unread badge.
// Polls so an invite that arrives mid-session surfaces without a reload.
// ponytail: 60s poll, no websocket — fine for a per-user count that isn't urgent.
function useInviteCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/invites")
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => { if (live) setCount(Array.isArray(d) ? d.length : 0); })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return count;
}

type User = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role: "ADMIN" | "MANAGER" | "MEMBER";
};

export function NavBar({ user }: { user: User }) {
  const pathname = usePathname();
  const inviteCount = useInviteCount();

  const links = [
    { href: "/standup", label: "My Day", roles: ["ADMIN", "MANAGER", "MEMBER"] },
    { href: "/tasks", label: "Task List", roles: ["ADMIN", "MANAGER"] },
    { href: "/feed", label: "Daily Feed", roles: ["ADMIN", "MANAGER", "MEMBER"] },
    { href: "/insights", label: "Insights", roles: ["ADMIN", "MANAGER", "MEMBER"] },
    { href: "/dashboard", label: "Team", roles: ["ADMIN", "MANAGER", "MEMBER"] },
    { href: "/profile", label: "Profile", roles: ["ADMIN", "MANAGER", "MEMBER"] },
  ].filter((l) => l.roles.includes(user.role));

  const initial = (user.name || user.email || "?")[0].toUpperCase();
  const adminActive = pathname.startsWith("/admin");

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-[#ece8e1]">
      <div className="flex items-center justify-between h-[58px] px-[26px]">
        <div className="flex items-center gap-[26px]">
          <Link href="/standup" className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-[15px]">C</span>
            <span className="font-semibold tracking-[-0.01em] text-[#1c1a17]">Cadence</span>
          </Link>
          <nav className="flex gap-0.5">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "px-[13px] py-[7px] rounded-lg text-sm transition-colors",
                    active
                      ? "bg-primary-soft text-primary font-semibold"
                      : "bg-transparent text-[#6b665f] font-medium hover:bg-[#f6f4f1]"
                  )}
                >
                  {link.label}
                  {link.href === "/standup" && inviteCount > 0 && (
                    <span
                      title={`${inviteCount} shared task${inviteCount > 1 ? "s" : ""} to review`}
                      className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold align-middle"
                    >
                      {inviteCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3 text-sm text-[#6b665f]">
          <span className="hidden sm:block">{user.name || user.email}</span>
          <span
            className={cn(
              "mono text-[10px] tracking-[0.08em] px-[7px] py-0.5 rounded-[5px]",
              user.role === "ADMIN"
                ? "bg-[#f8f0dd] text-[#c08a2d]"
                : user.role === "MANAGER"
                  ? "bg-[#eae6fb] text-[#6a5acd]"
                  : "bg-[#f0ece5] text-[#6b665f]"
            )}
          >
            {user.role}
          </span>
          <span className="w-7 h-7 rounded-full bg-[#efe9e1] text-[#8a8378] flex items-center justify-center font-semibold">
            {initial}
          </span>
          {user.role === "ADMIN" && (
            <Link
              href="/admin"
              title="Admin settings"
              aria-label="Admin settings"
              className={cn(
                "text-[17px] leading-none p-1 inline-flex transition-colors",
                adminActive ? "text-primary" : "text-[#b0a99e] hover:text-[#6b665f]"
              )}
            >
              ⚙
            </Link>
          )}
          <span className="w-px h-[18px] bg-[#ece8e1]" />
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-[#b0a99e] hover:text-[#6b665f] transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
