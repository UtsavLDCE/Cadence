// Roles & Permissions reference matrix.
//
// This is the single source of truth for the read-only "Roles & Permissions"
// tab in the admin panel. It DOCUMENTS the access rules that are actually
// enforced in the codebase at BOTH layers — the UI hides controls a role can't
// use, and every API route re-checks the role server-side. The file:line refs
// below point at where each rule lives so the matrix can be kept honest as the
// code changes.
//
// Access levels:
//   "full" — can do this across the whole team / app.
//   "own"  — can do this, but only for their own content.
//   "none" — not allowed; the UI hides it and the API returns 403.

export type Role = "ADMIN" | "MANAGER" | "MEMBER";
export type Access = "full" | "own" | "none";

export type Capability = {
  label: string;
  detail: string;
  admin: Access;
  manager: Access;
  member: Access;
  // Where this rule is enforced on the server, for auditability.
  enforcedAt: string;
};

export type PermissionArea = {
  area: string;
  blurb: string;
  capabilities: Capability[];
};

export const ROLE_META: Record<Role, { label: string; blurb: string }> = {
  ADMIN: { label: "Admin", blurb: "Full control — everything a manager can do, plus users, teams, and settings." },
  MANAGER: { label: "Manager", blurb: "Sees and manages the whole team's work, but not app configuration or user accounts." },
  MEMBER: { label: "Member", blurb: "Plans and tracks their own day. No team-wide visibility or configuration." },
};

// Everyone is also a "worker": admins and managers plan their own day exactly
// like a member does. That's why the personal-work rows below are "own" for all
// three roles — role only ever adds team-wide reach on top of personal work.
export const PERMISSION_MATRIX: PermissionArea[] = [
  {
    area: "My day & personal work",
    blurb: "Every user — whatever their role — plans and tracks their own day here.",
    capabilities: [
      {
        label: "Plan own day & set a daily goal",
        detail: "Create the day's plan, set a goal, and submit it to lock the plan.",
        admin: "own", manager: "own", member: "own",
        enforcedAt: "api/day-plan/route.ts",
      },
      {
        label: "Add & edit own tasks",
        detail: "Add planned tasks, update status, notes, effort, priority, category, and tags on own tasks.",
        admin: "own", manager: "own", member: "own",
        enforcedAt: "api/tasks/route.ts, api/tasks/[id]/route.ts",
      },
      {
        label: "Log unplanned / backdated done work",
        detail: "Record work that already happened as DONE, optionally on an earlier day.",
        admin: "own", manager: "own", member: "own",
        enforcedAt: "api/tasks/route.ts",
      },
      {
        label: "Delete own task",
        detail: "Remove a task from own plan while the day is unlocked. (Managers can delete any task — see below.)",
        admin: "own", manager: "own", member: "own",
        enforcedAt: "api/tasks/[id]/route.ts",
      },
      {
        label: "Carry over & defer own tasks",
        detail: "Bring an overdue task forward to today, or push a task to a future day.",
        admin: "own", manager: "own", member: "own",
        enforcedAt: "api/tasks/[id]/carry/route.ts, api/tasks/[id]/route.ts",
      },
      {
        label: "Manage own backlog queue",
        detail: "Add, edit, delete, and promote items in own personal queue.",
        admin: "own", manager: "own", member: "own",
        enforcedAt: "api/queue/route.ts, api/queue/[id]/route.ts",
      },
      {
        label: "Own daily standup",
        detail: "Fill in and edit own morning/end-of-day standup responses.",
        admin: "own", manager: "own", member: "own",
        enforcedAt: "api/standup/route.ts",
      },
      {
        label: "Own personal insights",
        detail: "See own completion trends, category breakdown, and discipline score.",
        admin: "own", manager: "own", member: "own",
        enforcedAt: "app/(app)/insights/page.tsx",
      },
    ],
  },
  {
    area: "Team task management",
    blurb: "The Task List and load-balancing tools that act across everyone's work.",
    capabilities: [
      {
        label: "Open the Task List",
        detail: "See every task across the whole team, filterable by owner, status, priority, category, tag, and text.",
        admin: "full", manager: "full", member: "none",
        enforcedAt: "app/(app)/tasks/page.tsx, nav-bar.tsx",
      },
      {
        label: "Add a task to any member's day",
        detail: "Create a task straight onto a member's plan — bypasses their day-lock.",
        admin: "full", manager: "full", member: "none",
        enforcedAt: "api/manager/tasks/route.ts",
      },
      {
        label: "Edit any member's task",
        detail: "Change title, notes, priority, estimate, actual effort, status, category, and tags on anyone's task.",
        admin: "full", manager: "full", member: "none",
        enforcedAt: "api/manager/tasks/[id]/route.ts",
      },
      {
        label: "Delete any member's task",
        detail: "Remove a task from any member's plan, even after their day is locked.",
        admin: "full", manager: "full", member: "none",
        enforcedAt: "api/tasks/[id]/route.ts",
      },
      {
        label: "Reassign a task to another member",
        detail: "Move a pending task from one member to another to balance load.",
        admin: "full", manager: "full", member: "none",
        enforcedAt: "api/manager/tasks/[id]/reassign/route.ts",
      },
      {
        label: "Assign work to a member's backlog",
        detail: "Push a task into another member's personal queue for later.",
        admin: "full", manager: "full", member: "none",
        enforcedAt: "api/manager/queue/route.ts",
      },
    ],
  },
  {
    area: "Team visibility",
    blurb: "Dashboards and analytics that show the whole team's activity.",
    capabilities: [
      {
        label: "Team Overview dashboard",
        detail: "Per-member load, discipline, done-today, overdue, and no-plan flags.",
        admin: "full", manager: "full", member: "none",
        enforcedAt: "app/(app)/dashboard/page.tsx",
      },
      {
        label: "Team Insights",
        detail: "All members' productivity, discipline scores, trends, and category breakdowns.",
        admin: "full", manager: "full", member: "none",
        enforcedAt: "app/(app)/insights/page.tsx",
      },
      {
        label: "Pending backlog / load balancing",
        detail: "See every unfinished task across the team in one place.",
        admin: "full", manager: "full", member: "none",
        enforcedAt: "app/(app)/dashboard/page.tsx",
      },
      {
        label: "View all standups for a day",
        detail: "Read every member's morning/EOD standup for a given date.",
        admin: "full", manager: "full", member: "none",
        enforcedAt: "api/standup/route.ts",
      },
    ],
  },
  {
    area: "Administration",
    blurb: "User accounts, teams, and app-wide configuration. Admin only.",
    capabilities: [
      {
        label: "Open the Admin panel",
        detail: "Access the admin area at all.",
        admin: "full", manager: "none", member: "none",
        enforcedAt: "app/(app)/admin/page.tsx, nav-bar.tsx",
      },
      {
        label: "Create users & change roles",
        detail: "Add accounts and set anyone's role (Admin / Manager / Member).",
        admin: "full", manager: "none", member: "none",
        enforcedAt: "api/users/route.ts",
      },
      {
        label: "Create & delete teams",
        detail: "Manage teams and assign their managers.",
        admin: "full", manager: "none", member: "none",
        enforcedAt: "api/teams/route.ts, api/teams/[id]/route.ts",
      },
      {
        label: "App settings",
        detail: "Change the standup cutoff time and other app-wide settings.",
        admin: "full", manager: "none", member: "none",
        enforcedAt: "api/settings/route.ts",
      },
      {
        label: "Exclude a user from Insights",
        detail: "Hide a user (e.g. a manager) from the team Insights report.",
        admin: "full", manager: "none", member: "none",
        enforcedAt: "api/users/route.ts",
      },
    ],
  },
  {
    area: "Shared vocabulary",
    blurb: "Categories and tags are a single shared list everyone contributes to.",
    capabilities: [
      {
        label: "View & create categories and tags",
        detail: "Read the shared category/tag lists and add new ones while tagging work.",
        admin: "full", manager: "full", member: "full",
        enforcedAt: "api/categories/route.ts, api/tags/route.ts",
      },
    ],
  },
];
