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
  excludedFromInsights: boolean;
  team: { id: string; name: string } | null;
};

type Team = {
  id: string;
  name: string;
  manager: { id: string; name: string | null; email: string | null } | null;
  _count: { members: number };
};

type Settings = { cutoffTime: string; timezone: string };

type PhaseState = { sentAt: string; respondedAt: string | null } | null;
type TeamsRow = { id: string; name: string | null; email: string | null; MORNING: PhaseState; EOD: PhaseState };
type TeamsConfig = { enabled: boolean; flowUrl: boolean; secret: boolean };
type TeamsSettings = { enabled: boolean; flowUrl: string; secretSet: boolean };

type Props = {
  users: User[];
  teams: Team[];
  settings: Settings;
  teamsToday: TeamsRow[];
  teamsConfig: TeamsConfig;
  teamsSettings: TeamsSettings;
  teamsDateLabel: string;
};

export function AdminClient({ users, teams, settings, teamsToday, teamsConfig, teamsSettings, teamsDateLabel }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"users" | "roles" | "teams" | "settings" | "integrations">("users");
  const [dispatching, setDispatching] = useState<"morning" | "eod" | null>(null);

  // Teams integration config form (mirrors AppSettings; persisted via /api/settings).
  const [tEnabled, setTEnabled] = useState(teamsSettings.enabled);
  const [tFlowUrl, setTFlowUrl] = useState(teamsSettings.flowUrl);
  const [tSecret, setTSecret] = useState(""); // blank = keep stored secret
  const [tSavingCfg, setTSavingCfg] = useState(false);
  const [tTesting, setTTesting] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamManagerId, setNewTeamManagerId] = useState("");
  const [cutoffTime, setCutoffTime] = useState(settings.cutoffTime);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // New-user form
  const [nu, setNu] = useState({ name: "", email: "", password: "", role: "MEMBER", teamId: "" });
  const [creatingUser, setCreatingUser] = useState(false);

  const managers = users.filter((u) => u.role === "MANAGER" || u.role === "ADMIN");

  async function updateUser(userId: string, field: "role" | "teamId", value: string) {
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
      }),
    });
    setCreatingUser(false);
    if (res.ok) {
      setNu({ name: "", email: "", password: "", role: "MEMBER", teamId: "" });
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

  async function saveTeamsConfig(e: React.FormEvent) {
    e.preventDefault();
    setTSavingCfg(true);
    setMessage(null);
    const payload: Record<string, unknown> = {
      teamsEnabled: tEnabled,
      teamsFlowUrl: tFlowUrl.trim(),
    };
    if (tSecret.trim()) payload.teamsSharedSecret = tSecret.trim();
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setTSavingCfg(false);
    if (res.ok) {
      setTSecret("");
      setMessage({ type: "success", text: "Teams settings saved." });
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setMessage({ type: "error", text: d.error || "Failed to save Teams settings." });
    }
  }

  function generateSecret() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    setTSecret(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
  }

  async function sendTestDm() {
    setTTesting(true);
    setMessage(null);
    const res = await fetch("/api/integrations/teams/test", { method: "POST" });
    setTTesting(false);
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMessage({ type: "success", text: `Test card sent to ${d.email}. Check your Teams chat.` });
    } else {
      setMessage({ type: "error", text: d.error || "Test failed." });
    }
  }

  async function sendTeamsPrompt(phase: "morning" | "eod") {
    setDispatching(phase);
    setMessage(null);
    const res = await fetch(`/api/integrations/teams/dispatch?phase=${phase}`, { method: "POST" });
    setDispatching(null);
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMessage({
        type: "success",
        text: `${phase === "morning" ? "Morning" : "End-of-day"} prompt: ${d.sent} sent, ${d.skipped} skipped, ${d.failed} failed.`,
      });
      router.refresh();
    } else {
      setMessage({ type: "error", text: d.error || "Failed to send prompts." });
    }
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
          { key: "integrations", label: "Integrations" },
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
              Add a team member and assign them to a team — the team&apos;s manager becomes their manager.
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
                  <option value="">No team / no manager</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — manager: {t.manager?.name || t.manager?.email || "none"}
                    </option>
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

      {activeTab === "integrations" && (
        <div className="space-y-4">
          {/* Configuration form */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-gray-900 mb-1">Microsoft Teams daily prompts</h2>
                <p className="text-xs text-gray-500 mb-4 max-w-2xl">
                  On weekdays the portal DMs each member a morning planning card (goal + estimates)
                  and an end-of-day status card in Teams; their replies write straight back here.
                  Members are matched to Teams by email. Paste your Power Automate flow URL and a
                  shared secret below — no redeploy needed.
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full",
                  teamsConfig.enabled && teamsConfig.flowUrl && teamsConfig.secret
                    ? "bg-green-50 text-green-700"
                    : "bg-gray-100 text-gray-500",
                )}
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    teamsConfig.enabled && teamsConfig.flowUrl && teamsConfig.secret
                      ? "bg-green-500"
                      : "bg-gray-400",
                  )}
                />
                {teamsConfig.enabled
                  ? teamsConfig.flowUrl && teamsConfig.secret
                    ? "Live"
                    : "Enabled · incomplete"
                  : "Disabled"}
              </span>
            </div>

            <form onSubmit={saveTeamsConfig} className="space-y-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={tEnabled}
                  onChange={(e) => setTEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-300"
                />
                <span className="text-sm font-medium text-gray-700">
                  Enable weekday Teams prompts
                </span>
              </label>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Power Automate flow URL
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  The flow&apos;s &quot;When a HTTP request is received&quot; trigger URL. The portal POSTs cards here.
                </p>
                <input
                  type="url"
                  value={tFlowUrl}
                  onChange={(e) => setTFlowUrl(e.target.value)}
                  placeholder="https://prod-00.westus.logic.azure.com:443/workflows/…/triggers/manual/paths/invoke?…"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Shared secret{" "}
                  {teamsSettings.secretSet && (
                    <span className="text-xs font-normal text-green-700">· a secret is saved</span>
                  )}
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Authenticates the portal↔flow↔cron calls. Use the same value in the flow and the
                  crontab. Leave blank to keep the saved one.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tSecret}
                    onChange={(e) => setTSecret(e.target.value)}
                    placeholder={teamsSettings.secretSet ? "•••••••• (unchanged)" : "Paste or generate a long random secret"}
                    className="flex-1 font-mono text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <button
                    type="button"
                    onClick={generateSecret}
                    className="shrink-0 text-xs font-medium text-indigo-700 border border-indigo-200 hover:bg-indigo-50 px-3 py-2 rounded-lg transition-colors"
                  >
                    Generate
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="submit"
                  disabled={tSavingCfg}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {tSavingCfg ? "Saving…" : "Save settings"}
                </button>
                <button
                  type="button"
                  onClick={sendTestDm}
                  disabled={!teamsConfig.flowUrl || !teamsConfig.secret || tTesting}
                  title={
                    !teamsConfig.flowUrl || !teamsConfig.secret
                      ? "Save a flow URL and secret first"
                      : "Send a test card to your own Teams DM"
                  }
                  className="bg-white border border-indigo-600 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {tTesting ? "Sending…" : "Send test DM to myself"}
                </button>
              </div>
            </form>

            <div className="mt-5 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2">
                Send today&apos;s prompts to all members now (also runs automatically on the weekday cron):
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => sendTeamsPrompt("morning")}
                  disabled={!teamsConfig.enabled || !teamsConfig.flowUrl || dispatching !== null}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {dispatching === "morning" ? "Sending…" : "Send morning prompt now"}
                </button>
                <button
                  type="button"
                  onClick={() => sendTeamsPrompt("eod")}
                  disabled={!teamsConfig.enabled || !teamsConfig.flowUrl || dispatching !== null}
                  className="bg-white border border-indigo-600 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {dispatching === "eod" ? "Sending…" : "Send end-of-day prompt now"}
                </button>
              </div>
            </div>
          </div>

          {/* Today's per-member status */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 text-sm">Today&apos;s prompts</h3>
              <p className="text-xs text-gray-500">{teamsDateLabel}</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Member</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Morning plan</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">End-of-day status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {teamsToday.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{m.name || "—"}</p>
                      <p className="text-xs text-gray-500">{m.email}</p>
                    </td>
                    <td className="px-4 py-3"><PromptCell state={m.MORNING} /></td>
                    <td className="px-4 py-3"><PromptCell state={m.EOD} /></td>
                  </tr>
                ))}
                {teamsToday.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">No members to prompt.</td></tr>
                )}
              </tbody>
            </table>
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

function PromptCell({ state }: { state: PhaseState }) {
  if (!state) return <span className="text-xs text-gray-400">Not sent</span>;
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (state.respondedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Replied {time(state.respondedAt)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      Sent {time(state.sentAt)} · awaiting reply
    </span>
  );
}
