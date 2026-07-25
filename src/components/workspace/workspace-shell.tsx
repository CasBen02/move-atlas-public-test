"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import type {
  WorkspaceData,
  WorkspaceRecord,
} from "@/lib/data/types";
import { LegacyImportBanner } from "@/components/workspace/legacy-import-banner";
import { AreaIntelligencePanel } from "@/components/workspace/sections/area-intelligence";
import { PlanningAssistantPanel } from "@/components/workspace/sections/planning-assistant";
import { RouteCommandCenter } from "@/components/workspace/sections/route-command-center";
import {
  AccountPanel,
  BudgetPanel,
  CareerPanel,
  DocumentsPanel,
  HomesPanel,
  MovePanel,
  MoveToolsPanel,
  OverviewPanel,
  RoadmapPanel,
} from "@/components/workspace/sections/section-panels";

const navigation = [
  ["overview", "Overview", "⌂"],
  ["move", "My move", "↗"],
  ["roadmap", "Roadmap", "✓"],
  ["route", "Route command", "⌁"],
  ["areas", "Area intelligence", "◎"],
  ["homes", "Homes & rentals", "⌑"],
  ["budget", "Budget", "$"],
  ["career", "Career", "◇"],
  ["tools", "Move tools", "▣"],
  ["documents", "Documents", "≡"],
  ["assistant", "Assistant", "✦"],
] as const;

const sectionMeta: Record<string, { eyebrow: string; title: string; description: string }> = {
  overview: {
    eyebrow: "Your move at a glance",
    title: "One calm view of what matters next.",
    description: "Progress, decisions, and guardrails organized around real life.",
  },
  move: {
    eyebrow: "Move profile",
    title: "The context behind every recommendation.",
    description: "Household, timing, housing, and daily-life needs stay attached to this plan.",
  },
  roadmap: {
    eyebrow: "Roadmap",
    title: "A plan you can actually move through.",
    description: "Add, finish, and reopen tasks without losing the bigger picture.",
  },
  route: {
    eyebrow: "Route command center",
    title: "Choose the route that fits the vehicle and household.",
    description: "Real provider routes, official weather, and explicit coverage limits.",
  },
  areas: {
    eyebrow: "Area intelligence",
    title: "Evidence, never a black box.",
    description: "Compare official place context using only measures that are available.",
  },
  homes: {
    eyebrow: "Homes & rentals",
    title: "One calm shortlist across every home type.",
    description: "Apartments, condos, townhomes, houses, temporary stays, and more.",
  },
  budget: {
    eyebrow: "Move budget",
    title: "Plan the total cost, then keep it honest.",
    description: "Track estimates, actuals, reimbursements, and what has been paid.",
  },
  career: {
    eyebrow: "Career",
    title: "Keep opportunity connected to place.",
    description: "Save your own roles and notes without turning them into provider claims.",
  },
  tools: {
    eyebrow: "Move tools",
    title: "From first box to first ninety days.",
    description: "Packing, movers, utilities, address changes, and settling in.",
  },
  documents: {
    eyebrow: "Document center",
    title: "Track readiness without storing sensitive files.",
    description: "Move Atlas stores checklist metadata only for this launch.",
  },
  assistant: {
    eyebrow: "Planning assistant",
    title: "Turn your move context into the next useful action.",
    description: "Deterministic planning stays available even when a model is not connected.",
  },
  account: {
    eyebrow: "Account and privacy",
    title: "Your data should leave when you do.",
    description: "Export a sanitized copy or permanently delete your account.",
  },
};

export type RecordResource =
  | "tasks"
  | "areas"
  | "properties"
  | "budget"
  | "boxes"
  | "movers"
  | "utilities"
  | "address"
  | "documents"
  | "settling"
  | "career";

export type WorkspaceActions = {
  addRecord: (
    resource: RecordResource,
    payload: Record<string, unknown>,
  ) => Promise<boolean>;
  updateRecord: (
    resource: RecordResource,
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<boolean>;
  deleteRecord: (resource: RecordResource, id: string) => Promise<boolean>;
  busy: boolean;
};

export function WorkspaceShell({
  initial,
  section,
}: {
  initial: WorkspaceData;
  section: string;
}) {
  const router = useRouter();
  const [records, setRecords] = useState(initial.records);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const quickDialog = useRef<HTMLElement>(null);
  const careerEnabled =
    initial.preferences?.priority_tags?.includes("Career") ||
    (records.career?.length ?? 0) > 0;
  const meta = sectionMeta[section] ?? sectionMeta.overview;

  useEffect(() => {
    if (!quickOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    quickDialog.current
      ?.querySelector<HTMLElement>("button, a, input, select, textarea")
      ?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQuickOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [quickOpen]);

  const actions = useMemo<WorkspaceActions>(
    () => ({
      busy,
      async addRecord(resource, payload) {
        setBusy(true);
        const response = await fetch(
          `/api/move-plans/${initial.plan.id}/records/${resource}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        const result = (await response.json()) as {
          record?: WorkspaceRecord;
          error?: string;
        };
        setBusy(false);
        if (!response.ok || !result.record) {
          setToast(result.error ?? "That change could not be saved.");
          return false;
        }
        setRecords((current) => ({
          ...current,
          [resource]: [...(current[resource] ?? []), result.record as WorkspaceRecord],
        }));
        setToast("Saved to this move.");
        return true;
      },
      async updateRecord(resource, id, payload) {
        setBusy(true);
        const response = await fetch(
          `/api/move-plans/${initial.plan.id}/records/${resource}/${id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        const result = (await response.json()) as {
          record?: WorkspaceRecord;
          error?: string;
        };
        setBusy(false);
        if (!response.ok || !result.record) {
          setToast(result.error ?? "That change could not be saved.");
          return false;
        }
        setRecords((current) => ({
          ...current,
          [resource]: (current[resource] ?? []).map((record) =>
            record.id === id ? (result.record as WorkspaceRecord) : record,
          ),
        }));
        setToast("Updated.");
        return true;
      },
      async deleteRecord(resource, id) {
        setBusy(true);
        const response = await fetch(
          `/api/move-plans/${initial.plan.id}/records/${resource}/${id}`,
          { method: "DELETE" },
        );
        const result = (await response.json()) as { error?: string };
        setBusy(false);
        if (!response.ok) {
          setToast(result.error ?? "That item could not be removed.");
          return false;
        }
        setRecords((current) => ({
          ...current,
          [resource]: (current[resource] ?? []).filter(
            (record) => record.id !== id,
          ),
        }));
        setToast("Removed from this move.");
        return true;
      },
    }),
    [busy, initial.plan.id],
  );

  async function changePlan(moveId: string) {
    if (!moveId || moveId === initial.plan.id) return;
    setBusy(true);
    await fetch(`/api/move-plans/${moveId}/active`, { method: "POST" });
    router.push(`/app/${moveId}/overview`);
    router.refresh();
  }

  function page() {
    const props = { workspace: { ...initial, records }, actions };
    switch (section) {
      case "move":
        return <MovePanel {...props} />;
      case "roadmap":
        return <RoadmapPanel {...props} />;
      case "route":
        return <RouteCommandCenter {...props} />;
      case "areas":
        return <AreaIntelligencePanel {...props} />;
      case "homes":
        return <HomesPanel {...props} />;
      case "budget":
        return <BudgetPanel {...props} />;
      case "career":
        return <CareerPanel {...props} />;
      case "tools":
        return <MoveToolsPanel {...props} />;
      case "documents":
        return <DocumentsPanel {...props} />;
      case "assistant":
        return <PlanningAssistantPanel {...props} />;
      case "account":
        return <AccountPanel {...props} />;
      default:
        return <OverviewPanel {...props} />;
    }
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="brand-lockup inverse" href="/">
          <span className="brand-mark">M</span>
          <span>Move Atlas</span>
        </Link>

        <div className="plan-switcher">
          <span>Current move</span>
          <select
            aria-label="Switch move plan"
            defaultValue={initial.plan.id}
            disabled={busy}
            onChange={(event) => changePlan(event.target.value)}
          >
            {initial.plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          <Link className="plan-new-link" href="/setup">
            + New move plan
          </Link>
        </div>

        <nav aria-label="Move Atlas">
          {navigation
            .filter(([key]) => key !== "career" || careerEnabled)
            .map(([key, label, icon]) => (
              <Link
                aria-current={section === key ? "page" : undefined}
                className={section === key ? "active" : ""}
                href={`/app/${initial.plan.id}/${key}`}
                key={key}
              >
                <span aria-hidden="true">{icon}</span>
                {label}
              </Link>
            ))}
        </nav>

        <div className="sidebar-footer">
          <Link href={`/app/${initial.plan.id}/account`}>
            {initial.profile.display_name || initial.plan.person_name || "Account"}
          </Link>
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <div>
            <span className="route-kicker">
              {initial.plan.origin_label || "Origin"} <i>→</i>{" "}
              {initial.plan.destination_label || "Destination"}
            </span>
            <strong>{initial.plan.name}</strong>
          </div>
          <div className="topbar-actions">
            <span className="cloud-state">
              <i aria-hidden="true" /> Cloud saved
            </span>
            <button
              className="button compact primary"
              onClick={() => setQuickOpen(true)}
              type="button"
            >
              + Quick add
            </button>
          </div>
        </header>

        <main className="workspace-content" id="main-content">
          <LegacyImportBanner
            importedAt={initial.profile.legacy_import_completed_at}
            onMessage={setToast}
          />
          <div className="page-heading">
            <div>
              <span className="eyebrow">{meta.eyebrow}</span>
              <h1>{meta.title}</h1>
              <p>{meta.description}</p>
            </div>
          </div>
          {page()}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile">
        {[
          ["overview", "Overview", "⌂"],
          ["roadmap", "Plan", "✓"],
          ["route", "Route", "⌁"],
          ["tools", "Tools", "▣"],
          ["move", "More", "•••"],
        ].map(([key, label, icon]) => (
          <Link
            aria-current={section === key ? "page" : undefined}
            className={section === key ? "active" : ""}
            href={`/app/${initial.plan.id}/${key}`}
            key={key}
          >
            <span aria-hidden="true">{icon}</span>
            {label}
          </Link>
        ))}
      </nav>

      {quickOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setQuickOpen(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="quick-title"
            aria-modal="true"
            className="quick-modal"
            ref={quickDialog}
            role="dialog"
          >
            <button
              aria-label="Close quick add"
              className="modal-close"
              onClick={() => setQuickOpen(false)}
              type="button"
            >
              ×
            </button>
            <span className="eyebrow">Quick add</span>
            <h2 id="quick-title">What just entered your orbit?</h2>
            <div className="quick-grid">
              {[
                ["roadmap", "Roadmap task", "A deadline or next action"],
                ["homes", "Home", "Any property type or temporary stay"],
                ["budget", "Expense", "An estimate, actual, or reimbursement"],
                ["tools", "Packing box", "Contents, room, and moving-day status"],
              ].map(([key, label, helper]) => (
                <Link
                  href={`/app/${initial.plan.id}/${key}`}
                  key={key}
                  onClick={() => setQuickOpen(false)}
                >
                  <strong>{label}</strong>
                  <span>{helper}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {toast ? (
        <button
          className="toast"
          onClick={() => setToast("")}
          role="status"
          type="button"
        >
          {toast}
        </button>
      ) : null}
    </div>
  );
}
