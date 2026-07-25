"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { WorkspaceData, WorkspaceRecord } from "@/lib/data/types";
import type { WorkspaceActions } from "@/components/workspace/workspace-shell";

type PanelProps = {
  workspace: WorkspaceData;
  actions: WorkspaceActions;
};

const propertyTypes = [
  ["apartment", "Apartment"],
  ["condo", "Condo"],
  ["townhome", "Townhome"],
  ["single-family", "Single-family house"],
  ["multifamily", "Multifamily"],
  ["co-living", "Co-living"],
  ["new-build", "New build"],
  ["temporary", "Temporary stay"],
  ["other", "Other"],
];

function value(record: WorkspaceRecord, key: string) {
  const current = record[key];
  return typeof current === "string" || typeof current === "number"
    ? String(current)
    : "";
}

function bool(record: WorkspaceRecord, key: string) {
  return record[key] === true;
}

function money(cents: unknown) {
  const value = typeof cents === "number" ? cents : Number(cents);
  return Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value / 100)
    : "—";
}

function cents(value: FormDataEntryValue | null) {
  const amount = Number(String(value ?? "").replace(/[,$\s]/g, ""));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : 0;
}

function dateLabel(value: string | null) {
  if (!value) return "Date not set";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? "Date not set"
    : new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(date);
}

function EmptyState({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">↗</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

export function OverviewPanel({ workspace }: PanelProps) {
  const tasks = workspace.records.tasks ?? [];
  const done = tasks.filter((task) => task.status === "done").length;
  const budget = workspace.records.budget ?? [];
  const budgetTotal = budget.reduce(
    (sum, item) => sum + Number(item.estimated_cents ?? 0),
    0,
  );
  const factors = [
    Boolean(workspace.plan.onboarding_completed_at),
    tasks.length > 0 && done === tasks.length,
    (workspace.records.areas?.length ?? 0) > 0,
    (workspace.records.properties?.length ?? 0) > 0,
    (workspace.records.routes?.length ?? 0) > 0,
    budget.length > 0,
  ];
  const readiness = Math.round(
    (factors.filter(Boolean).length / factors.length) * 100,
  );
  const nextTasks = tasks.filter((task) => task.status !== "done").slice(0, 4);

  return (
    <div className="section-stack">
      <section className="hero-card dashboard-hero">
        <div>
          <span className="eyebrow lime">Move readiness</span>
          <h2>
            {workspace.plan.destination_label
              ? `${workspace.plan.destination_label} is coming into focus.`
              : "Your next place starts here."}
          </h2>
          <p>
            {done} of {tasks.length} roadmap tasks complete · target{" "}
            {dateLabel(workspace.plan.target_date)}
          </p>
          <div className="hero-actions">
            <Link
              className="button light"
              href={`/app/${workspace.plan.id}/roadmap`}
            >
              Continue roadmap
            </Link>
            <Link
              className="button outline-light"
              href={`/app/${workspace.plan.id}/route`}
            >
              Plan the drive
            </Link>
          </div>
        </div>
        <div className="readiness-ring" style={{ "--progress": readiness } as React.CSSProperties}>
          <strong>{readiness}%</strong>
          <span>ready</span>
        </div>
      </section>

      <div className="metric-grid four">
        <article className="metric-card">
          <span>Roadmap</span>
          <strong>
            {done}/{tasks.length}
          </strong>
          <small>tasks complete</small>
        </article>
        <article className="metric-card">
          <span>Areas</span>
          <strong>{workspace.records.areas?.length ?? 0}</strong>
          <small>in your shortlist</small>
        </article>
        <article className="metric-card">
          <span>Homes</span>
          <strong>{workspace.records.properties?.length ?? 0}</strong>
          <small>across every property type</small>
        </article>
        <article className="metric-card">
          <span>Budget</span>
          <strong>{money(budgetTotal)}</strong>
          <small>currently estimated</small>
        </article>
      </div>

      <div className="content-grid two-thirds">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Next actions</span>
              <h3>Keep the move in motion</h3>
            </div>
            <Link href={`/app/${workspace.plan.id}/roadmap`}>Full roadmap →</Link>
          </div>
          {nextTasks.length ? (
            <div className="task-list">
              {nextTasks.map((task) => (
                <div className="task-row" key={task.id}>
                  <i aria-hidden="true" />
                  <div>
                    <strong>{value(task, "title")}</strong>
                    <span>
                      {value(task, "category")} ·{" "}
                      {value(task, "timing_label") || "No timing set"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No open tasks"
              text="Your roadmap is clear. Add the next action when it appears."
            />
          )}
        </section>

        <aside className="panel guardrail-panel">
          <span className="eyebrow">Your guardrails</span>
          <h3>{money(workspace.plan.housing_max_cents)}</h3>
          <p>Monthly housing ceiling</p>
          <dl>
            <div>
              <dt>Property path</dt>
              <dd>{workspace.plan.housing_intent || "Still deciding"}</dd>
            </div>
            <div>
              <dt>Commute</dt>
              <dd>
                {workspace.preferences?.max_commute_minutes
                  ? `≤ ${workspace.preferences.max_commute_minutes} minutes`
                  : "No ceiling set"}
              </dd>
            </div>
            <div>
              <dt>Move fund</dt>
              <dd>{money(workspace.plan.move_fund_target_cents)}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}

export function MovePanel({ workspace }: PanelProps) {
  const preferences = workspace.preferences;
  return (
    <div className="section-stack">
      <section className="panel move-profile">
        <div className="profile-route">
          <div>
            <span>From</span>
            <strong>{workspace.plan.origin_label || "Not set"}</strong>
          </div>
          <i>→</i>
          <div>
            <span>To</span>
            <strong>{workspace.plan.destination_label || "Not set"}</strong>
          </div>
        </div>
        <div className="metric-grid four">
          <article>
            <span>Target date</span>
            <strong>{dateLabel(workspace.plan.target_date)}</strong>
          </article>
          <article>
            <span>Household</span>
            <strong>{workspace.plan.household || "Not set"}</strong>
          </article>
          <article>
            <span>Housing path</span>
            <strong>{workspace.plan.housing_intent || "Undecided"}</strong>
          </article>
          <article>
            <span>Move type</span>
            <strong>{workspace.plan.move_type || "Undecided"}</strong>
          </article>
        </div>
      </section>

      <div className="content-grid two">
        <section className="panel">
          <span className="eyebrow">Home needs</span>
          <h3>A search broad enough for real life</h3>
          <div className="tag-list">
            {(preferences?.property_types ?? []).map((item) => (
              <span key={item}>{item.replaceAll("-", " ")}</span>
            ))}
          </div>
          <dl className="detail-list">
            <div>
              <dt>Bedrooms</dt>
              <dd>{preferences?.bedrooms ?? "Flexible"}</dd>
            </div>
            <div>
              <dt>Bathrooms</dt>
              <dd>{preferences?.bathrooms ?? "Flexible"}</dd>
            </div>
            <div>
              <dt>Pets</dt>
              <dd>{preferences?.pets?.join(", ") || "None listed"}</dd>
            </div>
            <div>
              <dt>Accessibility</dt>
              <dd>
                {preferences?.accessibility_needs?.join(", ") || "None listed"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <span className="eyebrow">Daily-life fit</span>
          <h3>What should the next place make easier?</h3>
          <div className="tag-list">
            {(preferences?.daily_needs ?? []).map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <dl className="detail-list">
            <div>
              <dt>Commute mode</dt>
              <dd>{preferences?.commute_mode || "Not set"}</dd>
            </div>
            <div>
              <dt>Commute ceiling</dt>
              <dd>
                {preferences?.max_commute_minutes
                  ? `${preferences.max_commute_minutes} minutes`
                  : "Not set"}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Move library</span>
            <h3>Every plan remains isolated</h3>
          </div>
          <Link className="button secondary compact" href="/setup?new=1">
            + New move plan
          </Link>
        </div>
        <div className="plan-library">
          {workspace.plans.map((plan) => (
            <Link
              className={plan.id === workspace.plan.id ? "current" : ""}
              href={`/app/${plan.id}/overview`}
              key={plan.id}
            >
              <span>{plan.id === workspace.plan.id ? "Current" : plan.status}</span>
              <strong>{plan.name}</strong>
              <small>
                {plan.origin_label || "Origin"} →{" "}
                {plan.destination_label || "Destination"}
              </small>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

export function RoadmapPanel({ workspace, actions }: PanelProps) {
  const tasks = workspace.records.tasks ?? [];
  const [showDone, setShowDone] = useState(true);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (
      await actions.addRecord("tasks", {
        title: data.get("title"),
        category: data.get("category"),
        timing_label: data.get("timing"),
        due_date: data.get("due") || null,
        status: "open",
        source: "user",
      })
    ) {
      form.reset();
    }
  }

  return (
    <div className="content-grid two-thirds">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Plan</span>
            <h3>{tasks.filter((task) => task.status !== "done").length} open actions</h3>
          </div>
          <label className="inline-toggle">
            <input
              checked={showDone}
              onChange={(event) => setShowDone(event.target.checked)}
              type="checkbox"
            />
            Show completed
          </label>
        </div>
        {tasks.length ? (
          <div className="task-list interactive">
            {tasks
              .filter((task) => showDone || task.status !== "done")
              .map((task) => {
                const done = task.status === "done";
                return (
                  <div className={`task-row ${done ? "done" : ""}`} key={task.id}>
                    <button
                      aria-label={done ? "Reopen task" : "Complete task"}
                      disabled={actions.busy}
                      onClick={() =>
                        actions.updateRecord("tasks", task.id, {
                          status: done ? "open" : "done",
                        })
                      }
                      type="button"
                    >
                      {done ? "✓" : ""}
                    </button>
                    <div>
                      <strong>{value(task, "title")}</strong>
                      <span>
                        {value(task, "category")} ·{" "}
                        {value(task, "timing_label") ||
                          dateLabel(value(task, "due_date") || null)}
                      </span>
                    </div>
                    <button
                      className="text-action danger"
                      onClick={() => actions.deleteRecord("tasks", task.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
          </div>
        ) : (
          <EmptyState
            title="Your roadmap is ready for its first task"
            text="Start with the one action that would make the move feel lighter."
          />
        )}
      </section>

      <aside className="panel sticky-form">
        <span className="eyebrow">Add an action</span>
        <h3>Make the next step concrete</h3>
        <form className="stack-form" onSubmit={add}>
          <label>
            Task
            <input name="title" required maxLength={160} />
          </label>
          <label>
            Area
            <select name="category" defaultValue="Planning">
              <option>Planning</option>
              <option>Housing</option>
              <option>Travel</option>
              <option>Packing</option>
              <option>Documents</option>
              <option>Money</option>
              <option>Settling in</option>
            </select>
          </label>
          <label>
            Timing
            <input name="timing" placeholder="This week" maxLength={80} />
          </label>
          <label>
            Due date
            <input name="due" type="date" />
          </label>
          <button className="button primary wide" disabled={actions.busy}>
            Add to roadmap
          </button>
        </form>
      </aside>
    </div>
  );
}

export function HomesPanel({ workspace, actions }: PanelProps) {
  const homes = workspace.records.properties ?? [];

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (
      await actions.addRecord("properties", {
        label: data.get("label"),
        address: data.get("address") || null,
        source_url: data.get("source_url") || null,
        property_type: data.get("property_type"),
        intent: data.get("intent"),
        asking_cost_cents: cents(data.get("cost")),
        monthly_utilities_cents: null,
        monthly_fees_cents: null,
        bedrooms: Number(data.get("bedrooms")) || null,
        bathrooms: Number(data.get("bathrooms")) || null,
        commute_text: data.get("commute") || null,
        status: "saved",
        details: data.get("details") || null,
      })
    ) {
      form.reset();
    }
  }

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Shortlist</span>
            <h3>{homes.length} homes across your search</h3>
          </div>
          <span className="status-chip neutral">Manual listings</span>
        </div>
        <p className="data-note">
          Move Atlas does not scrape listing sites. Saved prices and details are
          user-entered unless an authorized listing provider is connected.
        </p>
        {homes.length ? (
          <div className="property-grid">
            {homes.map((home) => (
              <article className="property-card" key={home.id}>
                <div className="property-visual">
                  <span>{value(home, "property_type").replaceAll("-", " ")}</span>
                  <i aria-hidden="true">⌑</i>
                </div>
                <div>
                  <span className="status-chip">{value(home, "status")}</span>
                  <h3>{value(home, "label")}</h3>
                  <p>{value(home, "address") || "Address not entered"}</p>
                  <dl>
                    <div>
                      <dt>Cost</dt>
                      <dd>{money(home.asking_cost_cents)}</dd>
                    </div>
                    <div>
                      <dt>Rooms</dt>
                      <dd>
                        {value(home, "bedrooms") || "—"} bd ·{" "}
                        {value(home, "bathrooms") || "—"} ba
                      </dd>
                    </div>
                  </dl>
                  <button
                    className="text-action danger"
                    onClick={() => actions.deleteRecord("properties", home.id)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Your shortlist is open"
            text="Add an apartment, condo, townhome, house, co-living option, build, or temporary stay."
          />
        )}
      </section>

      <details className="panel composer">
        <summary>+ Add a home or rental</summary>
        <form className="form-grid three" onSubmit={add}>
          <label className="span-two">
            Listing label
            <input
              name="label"
              required
              maxLength={200}
              placeholder="Oak Street apartment"
            />
          </label>
          <label>
            Property type
            <select name="property_type">
              {propertyTypes.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="span-two">
            Address
            <input name="address" maxLength={300} />
          </label>
          <label>
            Path
            <select name="intent" defaultValue={workspace.plan.housing_intent ?? "rent"}>
              <option value="rent">Rent</option>
              <option value="buy">Buy</option>
              <option value="either">Either</option>
              <option value="temporary">Temporary</option>
            </select>
          </label>
          <label>
            Asking cost
            <input name="cost" inputMode="decimal" placeholder="$2,400" />
          </label>
          <label>
            Bedrooms
            <input name="bedrooms" min="0" max="50" type="number" />
          </label>
          <label>
            Bathrooms
            <input name="bathrooms" min="0" max="50" step=".5" type="number" />
          </label>
          <label className="span-two">
            Source URL (optional)
            <input name="source_url" type="url" placeholder="https://…" />
          </label>
          <label>
            Commute note
            <input name="commute" maxLength={160} placeholder="24 min to work" />
          </label>
          <label className="full">
            Notes
            <textarea name="details" maxLength={2000} />
          </label>
          <button className="button primary" disabled={actions.busy}>
            Save to shortlist
          </button>
        </form>
      </details>
    </div>
  );
}

export function BudgetPanel({ workspace, actions }: PanelProps) {
  const items = workspace.records.budget ?? [];
  const estimate = items.reduce(
    (total, item) => total + Number(item.estimated_cents ?? 0),
    0,
  );
  const actual = items.reduce(
    (total, item) => total + Number(item.actual_cents ?? 0),
    0,
  );
  const paid = items
    .filter((item) => item.paid)
    .reduce(
      (total, item) =>
        total + Number(item.actual_cents ?? item.estimated_cents ?? 0),
      0,
    );

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (
      await actions.addRecord("budget", {
        name: data.get("name"),
        category: data.get("category"),
        phase: data.get("phase"),
        estimated_cents: cents(data.get("estimated")),
        actual_cents: data.get("actual") ? cents(data.get("actual")) : null,
        paid: false,
        reimbursable: data.get("reimbursable") === "on",
        currency: "USD",
      })
    ) {
      form.reset();
    }
  }

  return (
    <div className="section-stack">
      <div className="metric-grid four">
        <article className="metric-card featured">
          <span>Estimated</span>
          <strong>{money(estimate)}</strong>
          <small>{items.length} tracked items</small>
        </article>
        <article className="metric-card">
          <span>Actual</span>
          <strong>{money(actual)}</strong>
          <small>only entered actuals</small>
        </article>
        <article className="metric-card">
          <span>Paid</span>
          <strong>{money(paid)}</strong>
          <small>cash already out</small>
        </article>
        <article className="metric-card">
          <span>Move fund</span>
          <strong>{money(workspace.plan.move_fund_target_cents)}</strong>
          <small>your setup target</small>
        </article>
      </div>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Budget ledger</span>
            <h3>Estimates and actuals stay distinct</h3>
          </div>
        </div>
        {items.length ? (
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Phase</th>
                  <th>Estimate</th>
                  <th>Actual</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{value(item, "name")}</strong>
                      <span>{value(item, "category")}</span>
                    </td>
                    <td>{value(item, "phase")}</td>
                    <td>{money(item.estimated_cents)}</td>
                    <td>{item.actual_cents === null ? "—" : money(item.actual_cents)}</td>
                    <td>
                      <button
                        className={`status-chip ${item.paid ? "success" : "neutral"}`}
                        onClick={() =>
                          actions.updateRecord("budget", item.id, {
                            paid: !bool(item, "paid"),
                          })
                        }
                        type="button"
                      >
                        {item.paid ? "Paid" : "Open"}
                      </button>
                    </td>
                    <td>
                      <button
                        className="text-action danger"
                        onClick={() => actions.deleteRecord("budget", item.id)}
                        type="button"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No move costs yet"
            text="Add a moving, housing, travel, utility, or settling-in estimate."
          />
        )}
      </section>

      <details className="panel composer">
        <summary>+ Add a budget item</summary>
        <form className="form-grid three" onSubmit={add}>
          <label className="span-two">
            Expense
            <input name="name" required maxLength={160} />
          </label>
          <label>
            Category
            <select name="category">
              <option>Moving service</option>
              <option>Housing</option>
              <option>Travel</option>
              <option>Packing</option>
              <option>Utilities</option>
              <option>Storage</option>
              <option>Settling in</option>
              <option>Other</option>
            </select>
          </label>
          <label>
            Phase
            <select name="phase">
              <option value="before">Before</option>
              <option value="moving">Moving</option>
              <option value="after">After</option>
            </select>
          </label>
          <label>
            Estimated
            <input name="estimated" required inputMode="decimal" />
          </label>
          <label>
            Actual (optional)
            <input name="actual" inputMode="decimal" />
          </label>
          <label className="check-line">
            <input name="reimbursable" type="checkbox" />
            Reimbursable
          </label>
          <button className="button primary" disabled={actions.busy}>
            Add expense
          </button>
        </form>
      </details>
    </div>
  );
}

export function CareerPanel({ workspace, actions }: PanelProps) {
  const items = workspace.records.career ?? [];

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (
      await actions.addRecord("career", {
        name: data.get("name"),
        organization: data.get("organization") || null,
        status: "saved",
        location_mode: data.get("location_mode") || null,
        notes: data.get("notes") || null,
        user_rating: null,
      })
    ) {
      form.reset();
    }
  }

  return (
    <div className="content-grid two-thirds">
      <section className="panel">
        <span className="eyebrow">Saved opportunities</span>
        {items.length ? (
          <div className="record-list">
            {items.map((item) => (
              <article key={item.id}>
                <span className="status-chip">{value(item, "status")}</span>
                <h3>{value(item, "name")}</h3>
                <p>
                  {[value(item, "organization"), value(item, "location_mode")]
                    .filter(Boolean)
                    .join(" · ") || "No organization or location entered"}
                </p>
                <button
                  className="text-action danger"
                  onClick={() => actions.deleteRecord("career", item.id)}
                  type="button"
                >
                  Remove
                </button>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No saved opportunities"
            text="Keep career possibilities connected to the places you are comparing."
          />
        )}
      </section>
      <aside className="panel sticky-form">
        <span className="eyebrow">Add opportunity</span>
        <form className="stack-form" onSubmit={add}>
          <label>
            Role or opportunity
            <input name="name" required maxLength={160} />
          </label>
          <label>
            Organization
            <input name="organization" maxLength={160} />
          </label>
          <label>
            Location / work mode
            <input name="location_mode" maxLength={120} />
          </label>
          <label>
            Notes
            <textarea name="notes" maxLength={2000} />
          </label>
          <button className="button primary wide" disabled={actions.busy}>
            Save opportunity
          </button>
        </form>
      </aside>
    </div>
  );
}

const toolTabs = [
  ["boxes", "Packing"],
  ["movers", "Movers"],
  ["utilities", "Utilities"],
  ["address", "Address"],
  ["settling", "Settle in"],
] as const;

export function MoveToolsPanel({ workspace, actions }: PanelProps) {
  const [tool, setTool] = useState<(typeof toolTabs)[number][0]>("boxes");
  const items = workspace.records[tool] ?? [];

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    let payload: Record<string, unknown>;
    if (tool === "boxes") {
      payload = {
        box_number: Number(data.get("number")),
        room: data.get("name"),
        destination_room: data.get("detail") || null,
        contents: data.get("notes") || null,
        fragile: data.get("flag") === "on",
        priority: "normal",
        status: "planned",
      };
    } else if (tool === "movers") {
      payload = {
        company: data.get("name"),
        amount_cents: cents(data.get("amount")),
        deposit_cents: null,
        estimate_type: "User-entered",
        services: [],
        notes: data.get("notes") || null,
        status: "researching",
      };
    } else if (tool === "utilities") {
      payload = {
        service_name: data.get("name"),
        old_shutoff_date: data.get("date") || null,
        new_activation_date: data.get("detail") || null,
        confirmation_reference: null,
        notes: data.get("notes") || null,
        status: "not-started",
      };
    } else if (tool === "address") {
      payload = {
        organization: data.get("name"),
        category: data.get("detail") || null,
        due_date: data.get("date") || null,
        confirmation_reference: null,
        notes: data.get("notes") || null,
        status: "not-started",
      };
    } else {
      payload = {
        title: data.get("name"),
        timing_label: data.get("detail") || null,
        due_date: data.get("date") || null,
        completed_at: null,
      };
    }
    if (await actions.addRecord(tool, payload)) form.reset();
  }

  function primary(item: WorkspaceRecord) {
    if (tool === "boxes") return `Box ${value(item, "box_number")} · ${value(item, "room")}`;
    if (tool === "movers") return value(item, "company");
    if (tool === "utilities") return value(item, "service_name");
    if (tool === "address") return value(item, "organization");
    return value(item, "title");
  }

  function status(item: WorkspaceRecord) {
    if (tool === "settling") return item.completed_at ? "done" : "open";
    return value(item, "status") || "open";
  }

  async function advance(item: WorkspaceRecord) {
    if (tool === "boxes") {
      const cycle = ["planned", "packed", "loaded", "unloaded", "unpacked"];
      const index = cycle.indexOf(value(item, "status"));
      return actions.updateRecord(tool, item.id, {
        status: cycle[Math.min(index + 1, cycle.length - 1)],
      });
    }
    if (tool === "settling") {
      return actions.updateRecord(tool, item.id, {
        completed_at: item.completed_at ? null : new Date().toISOString(),
      });
    }
    const cycles: Record<string, string[]> = {
      movers: ["researching", "quoted", "shortlisted", "booked"],
      utilities: ["not-started", "scheduled", "confirmed", "complete"],
      address: ["not-started", "submitted", "confirmed"],
    };
    const cycle = cycles[tool] ?? [];
    const index = cycle.indexOf(value(item, "status"));
    return actions.updateRecord(tool, item.id, {
      status: cycle[Math.min(index + 1, cycle.length - 1)],
    });
  }

  return (
    <div className="section-stack">
      <div className="subnav" role="tablist" aria-label="Move tools">
        {toolTabs.map(([key, label]) => (
          <button
            aria-selected={tool === key}
            className={tool === key ? "active" : ""}
            key={key}
            onClick={() => setTool(key)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="content-grid two-thirds">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{toolTabs.find(([key]) => key === tool)?.[1]}</span>
              <h3>{items.length} tracked items</h3>
            </div>
          </div>
          {items.length ? (
            <div className="record-list">
              {items.map((item) => (
                <article key={item.id}>
                  <button
                    className="status-chip"
                    disabled={actions.busy}
                    onClick={() => advance(item)}
                    type="button"
                  >
                    {status(item)}
                  </button>
                  <h3>{primary(item)}</h3>
                  <p>
                    {value(item, "contents") ||
                      value(item, "notes") ||
                      value(item, "timing_label") ||
                      "No notes entered"}
                  </p>
                  <button
                    className="text-action danger"
                    onClick={() => actions.deleteRecord(tool, item.id)}
                    type="button"
                  >
                    Remove
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title={`No ${toolTabs
                .find(([key]) => key === tool)?.[1]
                .toLowerCase()} items yet`}
              text="Add the first item when you are ready."
            />
          )}
        </section>

        <aside className="panel sticky-form">
          <span className="eyebrow">Add item</span>
          <form className="stack-form" onSubmit={add}>
            {tool === "boxes" ? (
              <label>
                Box number
                <input name="number" required min="1" type="number" />
              </label>
            ) : null}
            <label>
              {tool === "boxes"
                ? "Room"
                : tool === "movers"
                  ? "Mover company"
                  : tool === "utilities"
                    ? "Utility"
                    : tool === "address"
                      ? "Organization"
                      : "Settling task"}
              <input name="name" required maxLength={160} />
            </label>
            {tool === "movers" ? (
              <label>
                Quote amount
                <input name="amount" inputMode="decimal" />
              </label>
            ) : null}
            {tool !== "boxes" && tool !== "movers" ? (
              <label>
                Date
                <input name="date" type="date" />
              </label>
            ) : null}
            <label>
              {tool === "boxes" ? "Destination room" : "Detail"}
              <input name="detail" maxLength={120} />
            </label>
            <label>
              Notes
              <textarea name="notes" maxLength={1000} />
            </label>
            {tool === "boxes" ? (
              <label className="check-line">
                <input name="flag" type="checkbox" />
                Fragile
              </label>
            ) : null}
            <button className="button primary wide" disabled={actions.busy}>
              Add item
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}

export function DocumentsPanel({ workspace, actions }: PanelProps) {
  const documents = workspace.records.documents ?? [];
  const [filter, setFilter] = useState("all");

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (
      await actions.addRecord("documents", {
        category: data.get("category"),
        title: data.get("title"),
        need_level: data.get("need_level"),
        timing_label: data.get("timing") || null,
        rationale: data.get("rationale") || null,
        status: "missing",
        expiration_date: null,
        custom_detail: null,
      })
    ) {
      form.reset();
    }
  }

  const cycle = ["missing", "requested", "ready", "expired", "not-applicable"];
  const visible = documents.filter(
    (document) => filter === "all" || document.status === filter,
  );

  return (
    <div className="section-stack">
      <section className="trust-banner">
        <strong>Checklist metadata only</strong>
        <p>
          Move Atlas does not accept document uploads for this launch and never asks
          you to store government IDs or financial account numbers here.
        </p>
      </section>
      <div className="subnav" aria-label="Document filter">
        {["all", ...cycle].map((status) => (
          <button
            className={filter === status ? "active" : ""}
            key={status}
            onClick={() => setFilter(status)}
            type="button"
          >
            {status.replace("-", " ")}
          </button>
        ))}
      </div>
      <section className="panel">
        {visible.length ? (
          <div className="document-list">
            {visible.map((document) => {
              const index = cycle.indexOf(value(document, "status"));
              return (
                <article key={document.id}>
                  <div>
                    <span>{value(document, "category")}</span>
                    <strong>{value(document, "title")}</strong>
                    <small>
                      {value(document, "timing_label") || "No timing note"}
                    </small>
                  </div>
                  <button
                    className="status-chip"
                    onClick={() =>
                      actions.updateRecord("documents", document.id, {
                        status: cycle[(index + 1) % cycle.length],
                      })
                    }
                    type="button"
                  >
                    {value(document, "status")}
                  </button>
                  <button
                    className="text-action danger"
                    onClick={() => actions.deleteRecord("documents", document.id)}
                    type="button"
                  >
                    Remove
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No checklist items in this view"
            text="Add a document requirement or choose another status."
          />
        )}
      </section>
      <details className="panel composer">
        <summary>+ Add checklist item</summary>
        <form className="form-grid three" onSubmit={add}>
          <label>
            Category
            <select name="category">
              <option>Identity</option>
              <option>Housing</option>
              <option>Vehicle</option>
              <option>Pets</option>
              <option>School</option>
              <option>Work</option>
              <option>Other</option>
            </select>
          </label>
          <label className="span-two">
            Checklist item
            <input name="title" required maxLength={160} />
          </label>
          <label>
            Need level
            <select name="need_level" defaultValue="recommended">
              <option value="required">Required</option>
              <option value="situation_dependent">Situation dependent</option>
              <option value="recommended">Recommended</option>
              <option value="optional">Optional</option>
            </select>
          </label>
          <label>
            Timing
            <input name="timing" maxLength={80} placeholder="Before move" />
          </label>
          <label>
            Why it matters
            <input name="rationale" maxLength={500} />
          </label>
          <button className="button primary" disabled={actions.busy}>
            Add checklist item
          </button>
        </form>
      </details>
    </div>
  );
}

export function AccountPanel({ workspace }: PanelProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function deleteAccount() {
    setBusy(true);
    const response = await fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, confirmation }),
    });
    const result = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error ?? "Account deletion failed.");
      return;
    }
    location.assign("/");
  }

  return (
    <div className="section-stack narrow">
      <section className="panel">
        <span className="eyebrow">Data portability</span>
        <h3>Take a readable, sanitized copy</h3>
        <p>
          The export includes your visible move data and sourced provider facts. It
          excludes passwords, sessions, credentials, raw provider payloads, security
          logs, and document contents.
        </p>
        <a className="button secondary" href="/api/account/export">
          Download JSON export
        </a>
      </section>
      <section className="panel danger-zone">
        <span className="eyebrow">Danger zone</span>
        <h3>Permanently delete this account</h3>
        <p>
          This deletes {workspace.plans.length} move plan(s) and their user-owned
          records. It cannot be undone.
        </p>
        <div className="form-grid two">
          <label>
            Current password
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <label>
            Type DELETE
            <input
              onChange={(event) => setConfirmation(event.target.value)}
              value={confirmation}
            />
          </label>
        </div>
        {message ? (
          <p className="form-message error" role="alert">
            {message}
          </p>
        ) : null}
        <button
          className="button danger"
          disabled={busy || password.length < 10 || confirmation !== "DELETE"}
          onClick={deleteAccount}
          type="button"
        >
          {busy ? "Deleting…" : "Delete account and all move data"}
        </button>
      </section>
    </div>
  );
}
