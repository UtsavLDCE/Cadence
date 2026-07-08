"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

type User = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role: "ADMIN" | "MANAGER" | "MEMBER";
};

export function NavBar({ user }: { user: User }) {
  const pathname = usePathname();

  const links = [
    { href: "/dashboard", label: "Overview", roles: ["ADMIN", "MANAGER", "MEMBER"] },
    { href: "/tasks", label: "Task List", roles: ["ADMIN", "MANAGER"] },
    { href: "/insights", label: "Insights", roles: ["ADMIN", "MANAGER", "MEMBER"] },
    { href: "/standup", label: "My Day", roles: ["ADMIN", "MANAGER", "MEMBER"] },
    { href: "/profile", label: "Profile", roles: ["ADMIN", "MANAGER", "MEMBER"] },
    { href: "/admin", label: "Admin", roles: ["ADMIN"] },
  ].filter((l) => l.roles.includes(user.role));

  const initial = (user.name || user.email || "?")[0].toUpperCase();

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="container mx-auto px-4 lg:px-8 max-w-[1600px] flex items-center justify-between h-14">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-lg">
            <span className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-white text-sm">D</span>
            <span className="text-gray-900">Cadence</span>
          </Link>
          <nav className="flex gap-1">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    active
                      ? "bg-primary-soft text-primary"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 hidden sm:block">{user.name || user.email}</span>
          <span className={cn(
            "text-xs px-2 py-0.5 rounded-full font-medium",
            user.role === "ADMIN" ? "bg-primary-soft text-primary" :
            user.role === "MANAGER" ? "bg-violet-100 text-violet-700" :
            "bg-gray-100 text-gray-600"
          )}>
            {user.role}
          </span>
          <span className="w-8 h-8 rounded-full bg-primary-soft text-primary flex items-center justify-center text-sm font-semibold">
            {initial}
          </span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
