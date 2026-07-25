"use client";

import { useEffect, useMemo, useState } from "react";

type LocalAccount = {
  id?: string;
  name?: string;
  email?: string;
  [key: string]: unknown;
};

export function LegacyImportBanner({
  importedAt,
  onMessage,
}: {
  importedAt: string | null;
  onMessage: (message: string) => void;
}) {
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (importedAt) return;
    const timer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem("moveAtlasStudio_accounts_v1");
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        const compatible = Array.isArray(parsed)
          ? parsed.filter(
              (item): item is LocalAccount =>
                Boolean(
                  item &&
                    typeof item === "object" &&
                    (item as LocalAccount).email?.toLowerCase() !==
                      "demo@moveatlas.local",
                ),
            )
          : [];
        setAccounts(compatible);
        setSelected(compatible[0]?.id ?? "");
      } catch {
        setAccounts([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [importedAt]);

  const chosen = useMemo(
    () =>
      accounts.find((account) => account.id === selected) ??
      (accounts.length === 1 ? accounts[0] : null),
    [accounts, selected],
  );

  if (importedAt || accounts.length === 0) return null;

  async function importAccount() {
    if (!chosen) return;
    setBusy(true);
    const response = await fetch("/api/import/local-v1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schema: "move-atlas-local-v1",
        sourceKey: "moveAtlasStudio_accounts_v1",
        selectedLocalAccountId: chosen.id ?? "legacy",
        account: chosen,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      counts?: { plans: number; records: number };
    };
    setBusy(false);
    if (!response.ok) {
      onMessage(result.error ?? "The local profile could not be imported.");
      return;
    }
    onMessage(
      `Imported ${result.counts?.plans ?? 0} move plan(s). Your browser copy remains untouched.`,
    );
    setAccounts([]);
    location.assign("/app");
  }

  return (
    <section className="import-banner">
      <div>
        <span className="status-chip">One-time import available</span>
        <strong>We found a Move Atlas profile saved in this browser.</strong>
        <p>
          Review and import it into your private cloud account. Local passwords,
          provider keys, generated route data, and demo records will never be imported.
        </p>
      </div>
      <button className="button secondary" onClick={() => setOpen(true)} type="button">
        Review import
      </button>
      {open ? (
        <div className="inline-import">
          <label>
            Local profile
            <select value={selected} onChange={(event) => setSelected(event.target.value)}>
              {accounts.map((account, index) => (
                <option key={account.id ?? index} value={account.id ?? ""}>
                  {account.name || account.email || `Local profile ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <p>
            Importing is transactional and one-time. Your browser copy is not deleted
            automatically.
          </p>
          <div>
            <button
              className="button ghost"
              disabled={busy}
              onClick={() => setOpen(false)}
              type="button"
            >
              Not now
            </button>
            <button
              className="button primary"
              disabled={busy || !chosen}
              onClick={importAccount}
              type="button"
            >
              {busy ? "Importing…" : "Import selected profile"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
