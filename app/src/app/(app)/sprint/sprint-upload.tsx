"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Managers/admins import the sprint CSV export. Re-uploading the same version
// replaces its items (clean refresh). Assignees are matched to users by the
// email local-part. Mirrors the admin Sprint tab's uploader — kept minimal here.
export function SprintUpload({ version: current }: { version: string | null }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState(current ?? "");
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
    setMsg(null);
    try {
      const csv = await file.text();
      const res = await fetch("/api/sprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: version.trim(), csv }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg({ ok: true, text: `Imported ${d.imported} items — ${d.matched} matched, ${d.unmatched} unmatched.` });
        setFile(null);
        router.refresh();
      } else {
        setMsg({ ok: false, text: d.error || "Import failed." });
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <details className="mb-6 bg-white rounded-xl border border-gray-200">
      <summary className="px-4 py-3 cursor-pointer select-none text-sm font-medium text-gray-700 hover:bg-gray-50">
        Import sprint CSV
      </summary>
      <div className="border-t border-gray-100 p-4">
        <p className="text-xs text-gray-500 mb-3">
          Upload the sprint tool export. Re-uploading the same version replaces its items.
          Assignees are matched to users by the part of their email before the @.
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
        {msg && (
          <p className={`mt-3 text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</p>
        )}
      </div>
    </details>
  );
}
