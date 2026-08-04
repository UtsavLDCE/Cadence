"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { PERMISSION_MATRIX, ROLE_META, type Access, type Role } from "@/lib/permissions";
import { TagInput, useTags, type Tag } from "@/components/tag-input";
import { useCategories } from "@/components/category-select";

type User = {
  id: string;
  name: string | null;
  email: string | null;
  role: "ADMIN" | "MANAGER" | "MEMBER" | "CXO";
  teamId: string | null;
  managerId: string | null;
  excludedFromInsights: boolean;
  team: { id: string; name: string } | null;
  manager: { id: string; name: string | null; email: string | null } | null;
  tags: Tag[];
};

type Team = {
  id: string;
  name: string;
  manager: { id: string; name: string | null; email: string | null } | null;
  _count: { members: number };
};

type Settings = { cutoffTime: string; timezone: string; maxTaskHours: number; workdayHours: number };

type Engagement = { lastActive: string | null; lastLogin: string | null; activeToday: boolean; tasks7: number; plans7: number; hours7: number };

type SprintItemRow = {
  id: string;
  externalId: string;
  title: string;
  workItemType: string | null;
  state: string | null;
  priority: string | null;
  matchedTaskTitle: string | null;
  matchedTaskDate: string | null;
};
type SprintMember = { userId: string; name: string | null; email: string | null; total: number; matched: number; items: SprintItemRow[] };
type Sprint = { version: string | null; totalItems: number; members: SprintMember[]; unassignedCount: number };

type Props = {
  users: User[];
  teams: Team[];
  settings: Settings;
  engagement: Record<string, Engagement>;
  sprint: Sprint;
};

export function AdminClient({ users, teams, settings, engagement, sprint }: Props) {
  const router = useRouter();
  const { data: session } = useSession();
  const meId = session?.user?.id;
  const { tags: tagVocab, createTag } = useTags();
  const [activeTab, setActiveTab] = useState<"users" | "engagement" | "sprint" | "roles" | "teams" | "categories" | "settings">("users");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamManagerId, setNewTeamManagerId] = useState("");
  const [cutoffTime, setCutoffTime] = useState(settings.cutoffTime);
  const [maxTaskHours, setMaxTaskHours] = useState(String(settings.maxTaskHours));
  const [workdayHours, setWorkdayHours] = useState(String(settings.workdayHours));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // New-user form
  const [nu, setNu] = useState({ name: "", email: "", password: "", role: "MEMBER", teamId: "", managerId: "" });
  const [creatingUser, setCreatingUser] = useState(false);

  // User being edited in the details modal (name / email / password).
  const [editing, setEditing] = useState<User | null>(null);

  // Team-manager dropdown still uses actual managers/admins.
  const managers = users.filter((u) => u.role === "MANAGER" || u.role === "ADMIN");
  // Reporting line (User.managerId) is just a user id — anyone can be someone's
  // manager, so members can carry reports without being handed the MANAGER role.
  const reportsTo = users;

  async function updateUser(userId: string, field: "role" | "teamId" | "managerId", value: string) {
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, [field]: value || null }),
    });
    if (res.ok) { router.refresh(); }
    else { setMessage({ type: "error", text: "Failed to update user." }); }
  }

  // Admin-only: assign the shared tag vocabulary to a user. Replaces the whole set.
  async function setUserTags(userId: string, next: Tag[]) {
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, tagIds: next.map((t) => t.id) }),
    });
    if (res.ok) { router.refresh(); }
    else { setMessage({ type: "error", text: "Failed to update tags." }); }
  }

  // Admin-only: hard-delete a user. Their tasks/plans/logs cascade; managed
  // teams have managerId nulled. Server also blocks self-delete.
  async function deleteUser(user: User) {
    if (!confirm(`Delete ${user.name || user.email}? Their tasks, plans, and logs are removed too. This can't be undone.`)) return;
    const res = await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    if (res.ok) { setMessage({ type: "success", text: "User deleted." }); router.refresh(); }
    else {
      const d = await res.json().catch(() => ({}));
      setMessage({ type: "error", text: d.error || "Failed to delete user." });
    }
  }

  // Admin-only: hide/show a user in the Insights team view.
  async function setExcluded(userId: string, excludedFromInsights: boolean) {
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, excludedFromInsights }),
    });
    if (res.ok) { router.refresh(); }
    else { setMessage({ type: "error", text: "Failed to update user." }); }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!nu.name.trim() || !nu.email.trim() || nu.password.length < 8) return;
    setCreatingUser(true);
    setMessage(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nu.name.trim(),
        email: nu.email.trim(),
        password: nu.password,
        role: nu.role,
        teamId: nu.teamId || undefined,
        managerId: nu.managerId || undefined,
      }),
    });
    setCreatingUser(false);
    if (res.ok) {
      setNu({ name: "", email: "", password: "", role: "MEMBER", teamId: "", managerId: "" });
      setMessage({ type: "success", text: "User created." });
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setMessage({ type: "error", text: d.error || "Failed to create user." });
    }
  }

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTeamName.trim(), managerId: newTeamManagerId || undefined }),
    });
    if (res.ok) {
      setNewTeamName("");
      setNewTeamManagerId("");
      setMessage({ type: "success", text: "Team created." });
      router.refresh();
    } else {
      setMessage({ type: "error", text: "Failed to create team." });
    }
  }

  async function deleteTeam(teamId: string, teamName: string) {
    if (!confirm(`Delete team "${teamName}"? This can't be undone.`)) return;
    const res = await fetch(`/api/teams/${teamId}`, { method: "DELETE" });
    if (res.ok) {
      setMessage({ type: "success", text: "Team deleted." });
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setMessage({ type: "error", text: d.error || "Failed to delete team." });
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    const maxT = parseFloat(maxTaskHours);
    const workD = parseFloat(workdayHours);
    if (!(maxT > 0) || !(workD > 0)) {
      setMessage({ type: "error", text: "Hour caps must be positive numbers." });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cutoffTime, maxTaskHours: maxT, workdayHours: workD }),
    });
    setSaving(false);
    const d = await res.json().catch(() => ({}));
    setMessage({ type: res.ok ? "success" : "error", text: res.ok ? "Settings saved." : d.error || "Failed to save." });
  }

  return (
    <div>
      {message && (
        <div className={cn(
          "mb-4 px-4 py-2 rounded-lg text-sm",
          message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
        )}>
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap gap-1 mb-6">
        {([
          { key: "users", label: `Users (${users.length})` },
          { key: "engagement", label: "Engagement" },
          { key: "sprint", label: "Sprint" },
          { key: "roles", label: "Roles & Permissions" },
          { key: "teams", label: `Teams (${teams.length})` },
          { key: "categories", label: "Categories" },
          { key: "settings", label: "Settings" },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === tab.key ? "bg-indigo-100 text-indigo-700" : "text-gray-600 hover:bg-gray-100"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "users" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-1">Create User</h2>
            <p className="text-xs text-gray-500 mb-4">
              Add a team member, assign a team, and set who they report to.
            </p>
            <form onSubmit={createUser} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={nu.name}
                  onChange={(e) => setNu((s) => ({ ...s, name: e.target.value }))}
                  placeholder="Full name"
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <input
                  type="email"
                  value={nu.email}
                  onChange={(e) => setNu((s) => ({ ...s, email: e.target.value }))}
                  placeholder="Email address"
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <input
                  type="password"
                  value={nu.password}
                  onChange={(e) => setNu((s) => ({ ...s, password: e.target.value }))}
                  placeholder="Temporary password (min 8 chars)"
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <select
                  value={nu.role}
                  onChange={(e) => setNu((s) => ({ ...s, role: e.target.value }))}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                >
                  <option value="MEMBER">Member</option>
                  <option value="MANAGER">Manager</option>
                  <option value="ADMIN">Admin</option>
                  <option value="CXO">CXO</option>
                </select>
                <select
                  value={nu.teamId}
                  onChange={(e) => setNu((s) => ({ ...s, teamId: e.target.value }))}
                  className="sm:col-span-2 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                >
                  <option value="">No team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — manager: {t.manager?.name || t.manager?.email || "none"}
                    </option>
                  ))}
                </select>
                <select
                  value={nu.managerId}
                  onChange={(e) => setNu((s) => ({ ...s, managerId: e.target.value }))}
                  className="sm:col-span-2 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                >
                  <option value="">No manager</option>
                  {reportsTo.map((m) => (
                    <option key={m.id} value={m.id}>Reports to: {m.name || m.email}</option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={creatingUser || !nu.name.trim() || !nu.email.trim() || nu.password.length < 8}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {creatingUser ? "Creating…" : "Create User"}
              </button>
            </form>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">User</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Team</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600" title="Who this user reports to.">Manager</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600" title="Tags on this user — shared vocabulary with task tags.">Tags</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600" title="Hide this user from the Insights team view — admin only.">
                  Exclude from Insights
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{user.name || "—"}</p>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) => updateUser(user.id, "role", e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                      <option value="MEMBER">Member</option>
                      <option value="MANAGER">Manager</option>
                      <option value="ADMIN">Admin</option>
                      <option value="CXO">CXO</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.teamId || ""}
                      onChange={(e) => updateUser(user.id, "teamId", e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                      <option value="">No team</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.managerId || ""}
                      onChange={(e) => updateUser(user.id, "managerId", e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                      <option value="">No manager</option>
                      {reportsTo.filter((m) => m.id !== user.id).map((m) => (
                        <option key={m.id} value={m.id}>{m.name || m.email}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 min-w-[220px]">
                    <TagInput
                      value={user.tags}
                      suggestions={tagVocab}
                      onCreate={createTag}
                      onChange={(next) => setUserTags(user.id, next)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={user.excludedFromInsights}
                        onChange={(e) => setExcluded(user.id, e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-300"
                      />
                      <span className="text-xs text-gray-500">
                        {user.excludedFromInsights ? "Excluded" : "Included"}
                      </span>
                    </label>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setEditing(user)}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                    >
                      Edit
                    </button>
                    {user.id !== meId && (
                      <button
                        type="button"
                        onClick={() => deleteUser(user)}
                        className="ml-3 text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {editing && (
            <EditUserModal
              user={editing}
              onClose={() => setEditing(null)}
              onSaved={() => { setEditing(null); setMessage({ type: "success", text: "User updated." }); router.refresh(); }}
              onError={(text) => setMessage({ type: "error", text })}
            />
          )}
        </div>
      )}

      {activeTab === "engagement" && <EngagementTab users={users} engagement={engagement} />}

      {activeTab === "sprint" && <SprintTab sprint={sprint} onMessage={setMessage} />}

      {activeTab === "roles" && <RolesTab />}

      {activeTab === "teams" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Create Team</h2>
            <form onSubmit={createTeam} className="flex gap-3">
              <input
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="Team name"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <select
                value={newTeamManagerId}
                onChange={(e) => setNewTeamManagerId(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">No manager</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.email}</option>
                ))}
              </select>
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Create
              </button>
            </form>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Team</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Manager</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Members</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {teams.map((team) => (
                  <tr key={team.id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{team.name}</td>
                    <td className="px-4 py-3 text-gray-600">{team.manager?.name || team.manager?.email || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{team._count.members}</td>
                    <td className="px-4 py-3 text-right">
                      {team._count.members === 0 ? (
                        <button
                          type="button"
                          onClick={() => deleteTeam(team.id, team.name)}
                          className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
                        >
                          Delete
                        </button>
                      ) : (
                        <span
                          className="text-xs text-gray-300"
                          title="Remove all members before deleting this team."
                        >
                          Delete
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {teams.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No teams yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "categories" && <CategoriesTab />}

      {activeTab === "settings" && (
        <div className="max-w-md">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">App Settings</h2>
            <form onSubmit={saveSettings} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Standup Cutoff Time
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Members who haven&apos;t submitted by this time are highlighted as missing.
                </p>
                <input
                  type="time"
                  value={cutoffTime}
                  onChange={(e) => setCutoffTime(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max hours per task
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Hard cap on a single task&apos;s estimate — bigger work must be split. Enforced everywhere a task or queue item is created or edited.
                </p>
                <input
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={maxTaskHours}
                  onChange={(e) => setMaxTaskHours(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 w-32"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Hours in a workday
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  A day&apos;s realistic capacity. Drives the over-plan warning and the minimum-plan floor (60% of this must be planned before a day can be submitted).
                </p>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={workdayHours}
                  onChange={(e) => setWorkdayHours(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 w-32"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {saving ? "Saving..." : "Save Settings"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Human "how long ago" from an ISO timestamp. JWT sessions aren't stored, so
// last-active is derived from the most recent task/plan/work-log/status activity.
function fmtLastActive(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Engagement view: who's active and how much they've logged in the last 7 days.
// "Active today" is the honest stand-in for "currently logged in" — with JWT
// sessions there's no server-side login/heartbeat to read, so recency of real
// activity is the closest signal.
function EngagementTab({ users, engagement }: { users: User[]; engagement: Record<string, Engagement> }) {
  const activeToday = users.filter((u) => engagement[u.id]?.activeToday).length;
  // Most-recently-active first; never-active users sink to the bottom.
  const ordered = [...users].sort((a, b) => {
    const ta = engagement[a.id]?.lastActive ? Date.parse(engagement[a.id].lastActive!) : 0;
    const tb = engagement[b.id]?.lastActive ? Date.parse(engagement[b.id].lastActive!) : 0;
    return tb - ta;
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Total users" value={String(users.length)} />
        <StatCard label="Active today" value={String(activeToday)} accent />
        <StatCard label="Idle" value={String(users.length - activeToday)} />
      </div>

      <p className="text-xs text-gray-500">
        &ldquo;Last login&rdquo; is stamped on each successful sign-in. &ldquo;Last active&rdquo; and the
        7-day counts are derived from real activity (tasks, day plans, work logs, status
        changes) — a user can be logged in without doing work, so the two can differ.
      </p>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">User</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600" title="Newest real activity (tasks, plans, work logs, status changes)">Last active</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600" title="Last successful login">Last login</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600" title="Tasks created in the last 7 days">Tasks (7d)</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600" title="Day plans submitted in the last 7 days">Plans (7d)</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600" title="Hours logged in the last 7 days">Hours (7d)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ordered.map((user) => {
              const e = engagement[user.id];
              return (
                <tr key={user.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("w-2 h-2 rounded-full shrink-0", e?.activeToday ? "bg-green-500" : "bg-gray-300")} />
                      <div>
                        <p className="font-medium text-gray-900">{user.name || "—"}</p>
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{fmtLastActive(e?.lastActive ?? null)}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtLastActive(e?.lastLogin ?? null)}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{e?.tasks7 ?? 0}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{e?.plans7 ?? 0}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{(e?.hours7 ?? 0).toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Sprint import + alignment. Admin uploads the sprint tool's CSV export; each
// row is matched to a Cadence user by email local-part, then each member's
// sprint items are compared (heuristically, by title) against the tasks they
// actually logged — surfacing who is/ isn't working on the sprint.
function SprintTab({
  sprint,
  onMessage,
}: {
  sprint: Sprint;
  onMessage: (m: { type: "success" | "error"; text: string } | null) => void;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState(sprint.version ?? "");
  const [uploading, setUploading] = useState(false);

  function onPick(f: File | null) {
    setFile(f);
    // Auto-fill version from a filename like "Version 8.7.6 (5).csv" → "8.7.6".
    if (f && !version) {
      const m = f.name.match(/(\d+\.\d+(?:\.\d+)?)/);
      setVersion(m ? m[1] : f.name.replace(/\.csv$/i, ""));
    }
  }

  async function upload() {
    if (!file || !version.trim()) return;
    setUploading(true);
    onMessage(null);
    try {
      const csv = await file.text();
      const res = await fetch("/api/sprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: version.trim(), csv }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        onMessage({ type: "success", text: `Imported ${d.imported} items — ${d.matched} matched to users, ${d.unmatched} unmatched.` });
        setFile(null);
        router.refresh();
      } else {
        onMessage({ type: "error", text: d.error || "Import failed." });
      }
    } finally {
      setUploading(false);
    }
  }

  const totalMatched = sprint.members.reduce((s, m) => s + m.matched, 0);
  const totalAssigned = sprint.members.reduce((s, m) => s + m.total, 0);
  const pct = totalAssigned ? Math.round((totalMatched / totalAssigned) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Import sprint CSV</h2>
        <p className="text-xs text-gray-500 mb-4">
          Upload the sprint tool export. Re-uploading the same version replaces its items
          (a clean refresh). Assignees are matched to users by the part of their email
          before the @.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            className="text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
          />
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="Version (e.g. 8.7.6)"
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <button
            type="button"
            onClick={upload}
            disabled={uploading || !file || !version.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {uploading ? "Importing…" : "Import"}
          </button>
        </div>
      </div>

      {!sprint.version ? (
        <p className="text-sm text-gray-400 text-center py-6">No sprint imported yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Current sprint" value={sprint.version} />
            <StatCard label="Work items" value={String(sprint.totalItems)} />
            <StatCard label="On-sprint (matched)" value={`${pct}%`} accent />
            <StatCard label="Unassigned items" value={String(sprint.unassignedCount)} />
          </div>

          <p className="text-xs text-gray-500">
            &ldquo;Matched&rdquo; means a task the member logged looks like the sprint item
            (title similarity — a best guess, not a hard link). Least-aligned members are
            listed first. Unassigned items had no matching Cadence user.
          </p>

          <div className="space-y-2">
            {sprint.members.map((m) => {
              const mpct = m.total ? Math.round((m.matched / m.total) * 100) : 0;
              return (
                <details key={m.userId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none hover:bg-gray-50">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{m.name || m.email || "—"}</p>
                      <p className="text-xs text-gray-500 truncate">{m.email}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={cn("text-sm font-semibold", mpct >= 70 ? "text-green-600" : mpct >= 40 ? "text-amber-600" : "text-red-600")}>
                        {m.matched}/{m.total} on sprint
                      </span>
                      <span className="text-xs text-gray-400 w-10 text-right">{mpct}%</span>
                    </div>
                  </summary>
                  <div className="border-t border-gray-100 divide-y divide-gray-100">
                    {m.items.map((it) => (
                      <div key={it.id} className="px-4 py-2.5 text-sm">
                        <div className="flex items-start gap-2">
                          <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", it.matchedTaskTitle ? "bg-green-500" : "bg-gray-300")} />
                          <div className="min-w-0">
                            <p className="text-gray-900">
                              <span className="text-gray-400">#{it.externalId}</span> {it.title}
                            </p>
                            <p className="text-xs text-gray-500">
                              {[it.workItemType, it.state, it.priority && `P${it.priority}`].filter(Boolean).join(" · ")}
                            </p>
                            {it.matchedTaskTitle ? (
                              <p className="text-xs text-green-700 mt-0.5">↳ logged: {it.matchedTaskTitle}</p>
                            ) : (
                              <p className="text-xs text-gray-400 mt-0.5">↳ no matching logged task</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
            {sprint.members.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">No sprint items matched a Cadence user.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Admin edits a user's identity + credentials. Name/email always sent; password
// only when a new one is typed (blank = leave unchanged). Server validates.
function EditUserModal({
  user,
  onClose,
  onSaved,
  onError,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
  onError: (text: string) => void;
}) {
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    if (password && password.length < 8) { onError("Password must be at least 8 characters"); return; }
    setSaving(true);
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        name: name.trim(),
        email: email.trim(),
        ...(password ? { password } : {}),
      }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else { const d = await res.json().catch(() => ({})); onError(d.error || "Failed to update user."); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-gray-900 mb-4">Edit user</h2>
        <form onSubmit={save} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Full name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Set new password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="text-sm font-medium text-gray-600 hover:text-gray-800 px-4 py-2">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim() || !email.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Manage the shared, team-wide category vocabulary (Meeting, PR Review, Scrum, …).
// Categories are global and reused across tasks so the /insights roll-up doesn't
// fragment on spelling. Any user can also add one inline from a task form; this
// tab is the deliberate place to seed the recurring set up front.
function CategoriesTab() {
  const { categories, createCategory, updateCategory } = useCategories();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    const cat = await createCategory(n);
    setBusy(false);
    if (cat) setName("");
    else setError("Couldn't add that category.");
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Categories</h2>
        <p className="text-xs text-gray-500 mb-4">
          Reusable work types applied to tasks — PR Review, Scrum, Meeting, and so on.
          Shared team-wide; used in the Insights &ldquo;where time goes&rdquo; roll-up.
        </p>
        <form onSubmit={add} className="flex gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category (e.g. PR Review)"
            maxLength={60}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </form>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {categories.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No categories yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Category ({categories.length})</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-40" title="Seeded/recurring category shown first in pickers.">Default</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-44" title="Recurring work type — its tasks are expected to repeat, so they're checked for daily re-adds.">Repeatable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none" title="Mark this category as default.">
                      <input
                        type="checkbox"
                        checked={c.isDefault}
                        onChange={(e) => updateCategory(c.id, { isDefault: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-300"
                      />
                      <span className={cn("text-xs font-medium", c.isDefault ? "text-green-700" : "text-gray-400")}>
                        {c.isDefault ? "Default" : "Custom"}
                      </span>
                    </label>
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none" title="Recurring work type — its tasks are checked for daily re-adds.">
                      <input
                        type="checkbox"
                        checked={c.repeatable}
                        onChange={(e) => updateCategory(c.id, { repeatable: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-300"
                      />
                      <span className={cn("text-xs font-medium", c.repeatable ? "text-indigo-700" : "text-gray-400")}>
                        {c.repeatable ? "Repeatable" : "One-off"}
                      </span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={cn("text-2xl font-bold mt-1", accent ? "text-green-600" : "text-gray-900")}>{value}</p>
    </div>
  );
}

const ROLE_ORDER: Role[] = ["ADMIN", "MANAGER", "MEMBER"];

// Read-only reference: what each role can do across the app. Mirrors the access
// rules enforced in the API routes and page guards (see @/lib/permissions).
function RolesTab() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Roles &amp; permissions</h2>
        <p className="text-xs text-gray-500 mb-4 max-w-3xl">
          What each role can do, across the whole app. This is a reference — every rule here is
          enforced on the server (the API returns 403) as well as hidden in the UI. Change a
          person&apos;s role in the <span className="font-medium">Users</span> tab.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {ROLE_ORDER.map((r) => (
            <div key={r} className="border border-gray-200 rounded-lg p-3">
              <RoleBadge role={r} />
              <p className="text-xs text-gray-500 mt-2">{ROLE_META[r].blurb}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5"><PermDot access="full" /> Full access</span>
          <span className="inline-flex items-center gap-1.5"><PermDot access="own" /> Own content only</span>
          <span className="inline-flex items-center gap-1.5"><PermDot access="none" /> No access</span>
        </div>
      </div>

      {PERMISSION_MATRIX.map((group) => (
        <div key={group.area} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900 text-sm">{group.area}</h3>
            <p className="text-xs text-gray-500">{group.blurb}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Capability</th>
                <th className="px-3 py-2.5 font-medium text-gray-600 text-center w-24">Admin</th>
                <th className="px-3 py-2.5 font-medium text-gray-600 text-center w-24">Manager</th>
                <th className="px-3 py-2.5 font-medium text-gray-600 text-center w-24">Member</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {group.capabilities.map((cap) => (
                <tr key={cap.label}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{cap.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{cap.detail}</p>
                  </td>
                  <td className="px-3 py-3 text-center"><PermCell access={cap.admin} /></td>
                  <td className="px-3 py-3 text-center"><PermCell access={cap.manager} /></td>
                  <td className="px-3 py-3 text-center"><PermCell access={cap.member} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const styles: Record<Role, string> = {
    ADMIN: "bg-indigo-100 text-indigo-700",
    MANAGER: "bg-sky-100 text-sky-700",
    MEMBER: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={cn("inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded", styles[role])}>
      {ROLE_META[role].label}
    </span>
  );
}

const PERM_META: Record<Access, { dot: string; text: string; label: string }> = {
  full: { dot: "bg-green-500", text: "text-green-700", label: "Full" },
  own: { dot: "bg-amber-500", text: "text-amber-700", label: "Own only" },
  none: { dot: "bg-gray-300", text: "text-gray-400", label: "—" },
};

function PermDot({ access }: { access: Access }) {
  return <span className={cn("w-2 h-2 rounded-full", PERM_META[access].dot)} />;
}

function PermCell({ access }: { access: Access }) {
  const m = PERM_META[access];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", m.text)}>
      <span className={cn("w-2 h-2 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}
