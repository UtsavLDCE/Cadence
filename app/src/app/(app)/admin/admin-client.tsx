"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { PERMISSION_MATRIX, ROLE_META, type Access, type Role } from "@/lib/permissions";

type User = {
  id: string;
  name: string | null;
  email: string | null;
  role: "ADMIN" | "MANAGER" | "MEMBER";
  teamId: string | null;
  managerId: string | null;
  excludedFromInsights: boolean;
  team: { id: string; name: string } | null;
  manager: { id: string; name: string | null; email: string | null } | null;
};

type Team = {
  id: string;
  name: string;
  manager: { id: string; name: string | null; email: string | null } | null;
  _count: { members: number };
};

type Settings = { cutoffTime: string; timezone: string };

type Props = {
  users: User[];
  teams: Team[];
  settings: Settings;
};

export function AdminClient({ users, teams, settings }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"users" | "roles" | "teams" | "settings">("users");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamManagerId, setNewTeamManagerId] = useState("");
  const [cutoffTime, setCutoffTime] = useState(settings.cutoffTime);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // New-user form
  const [nu, setNu] = useState({ name: "", email: "", password: "", role: "MEMBER", teamId: "", managerId: "" });
  const [creatingUser, setCreatingUser] = useState(false);

  const managers = users.filter((u) => u.role === "MANAGER" || u.role === "ADMIN");

  async function updateUser(userId: string, field: "role" | "teamId" | "managerId", value: string) {
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, [field]: value || null }),
    });
    if (res.ok) { router.refresh(); }
    else { setMessage({ type: "error", text: "Failed to update user." }); }
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
    setSaving(true);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cutoffTime }),
    });
    setSaving(false);
    setMessage({ type: res.ok ? "success" : "error", text: res.ok ? "Settings saved." : "Failed to save." });
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
          { key: "roles", label: "Roles & Permissions" },
          { key: "teams", label: `Teams (${teams.length})` },
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
                  {managers.map((m) => (
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
                <th className="text-left px-4 py-3 font-medium text-gray-600" title="Hide this user from the Insights team view — admin only.">
                  Exclude from Insights
                </th>
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
                      {managers.filter((m) => m.id !== user.id).map((m) => (
                        <option key={m.id} value={m.id}>{m.name || m.email}</option>
                      ))}
                    </select>
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
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

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
