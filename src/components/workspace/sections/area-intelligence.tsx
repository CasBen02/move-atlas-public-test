"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { HerePlace, ProviderResult } from "@/lib/providers";
import type { WorkspaceData, WorkspaceRecord } from "@/lib/data/types";
import type { WorkspaceActions } from "@/components/workspace/workspace-shell";

type StoredMetric = {
  id: string;
  measure_key: string;
  measure_name: string;
  availability: "available" | "unavailable";
  raw_display: string | null;
  normalized_fit_score: number | null;
  applied_weight: number | null;
  source_name: string | null;
  source_url: string | null;
  geography_label: string | null;
  reference_period: string | null;
  coverage_note: string | null;
  caveats: string[];
  retrieved_at: string | null;
};

type Evidence = {
  status: string;
  freshness?: "recently_updated" | "stale";
  message?: string;
  snapshot: null | {
    id: string;
    status: string;
    weighted_score: number | null;
    coverage_percent: number;
    generated_at: string;
    caveats: string[];
    resolved_geographies: Array<{ contextMessage?: string }>;
  };
  metrics: StoredMetric[];
};

type SearchResponse = ProviderResult<HerePlace[]>;

function localEvidenceFromCreate(value: {
  evidence?: {
    resolution?: ProviderResult<unknown>;
    profile?: ProviderResult<{
      geography: string;
      referenceYear: number;
      measures: Array<{
        id: string;
        name: string;
        rawValue: number | null;
        unit: string;
        coverage: string;
        caveats: string[];
        unavailableMessage: string | null;
      }>;
    }> | null;
    snapshot?: {
      id?: string;
      score?: {
        score: number | null;
        reliableCoveragePercent: number;
        excludedMetricIds: string[];
      };
      generatedAt?: string;
    } | null;
  };
}): Evidence | null {
  const evidence = value.evidence;
  const profile = evidence?.profile;
  const snapshot = evidence?.snapshot;
  if (!evidence || !snapshot) return null;
  const score = snapshot.score;
  return {
    status: score?.score === null ? "unavailable" : "partial",
    freshness: "recently_updated",
    snapshot: {
      id: snapshot.id ?? "pending",
      status: score?.score === null ? "unavailable" : "partial",
      weighted_score: score?.score ?? null,
      coverage_percent: score?.reliableCoveragePercent ?? 0,
      generated_at: snapshot.generatedAt ?? new Date().toISOString(),
      caveats: [],
      resolved_geographies: [],
    },
    metrics:
      profile?.status === "available"
        ? profile.data.measures.map((measure) => ({
            id: measure.id,
            measure_key: measure.id,
            measure_name: measure.name,
            availability:
              measure.rawValue === null ? "unavailable" : "available",
            raw_display:
              measure.rawValue === null
                ? null
                : measure.unit === "dollars"
                  ? new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    }).format(measure.rawValue)
                  : `${measure.rawValue.toLocaleString()} ${measure.unit}`,
            normalized_fit_score: null,
            applied_weight: null,
            source_name:
              "U.S. Census Bureau American Community Survey 5-year estimates",
            source_url: profile.meta.source,
            geography_label: profile.data.geography,
            reference_period: `${profile.data.referenceYear} ACS 5-year estimates`,
            coverage_note: measure.coverage,
            caveats: measure.caveats,
            retrieved_at: profile.meta.retrievedAt,
          }))
        : [],
  };
}

export function AreaIntelligencePanel({
  workspace,
  actions,
}: {
  workspace: WorkspaceData;
  actions: WorkspaceActions;
}) {
  const areas = useMemo(
    () => workspace.records.areas ?? [],
    [workspace.records.areas],
  );
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [selectedId, setSelectedId] = useState(areas[0]?.id ?? "");
  const [evidence, setEvidence] = useState<Record<string, Evidence>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    const missing = areas.filter((area) => !evidence[area.id]);
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(
      missing.map(async (area) => {
        const response = await fetch(`/api/areas/${area.id}/evidence`);
        if (!response.ok) return [area.id, null] as const;
        return [area.id, (await response.json()) as Evidence] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setEvidence((current) => ({
        ...current,
        ...Object.fromEntries(entries.filter((entry) => entry[1] !== null)),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [areas, evidence]);

  async function search(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setMessage("");
    const response = await fetch(`/api/areas/search?q=${encodeURIComponent(query)}`);
    const result = (await response.json()) as SearchResponse | { error?: string };
    setSearching(false);
    if (!("status" in result)) {
      setSearchResult(null);
      setMessage(result.error ?? "Place search is unavailable.");
      return;
    }
    setSearchResult(result);
  }

  async function add(place: HerePlace) {
    if (!place.position) return;
    setSearching(true);
    setMessage("");
    const hint =
      place.address.district &&
      place.title.toLowerCase().includes(place.address.district.toLowerCase())
        ? "neighborhood"
        : "auto";
    const response = await fetch("/api/areas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movePlanId: workspace.plan.id,
        place,
        hint,
      }),
    });
    const result = (await response.json()) as {
      record?: WorkspaceRecord;
      evidence?: Parameters<typeof localEvidenceFromCreate>[0]["evidence"];
      error?: string;
    };
    setSearching(false);
    if (!response.ok || !result.record) {
      setMessage(result.error ?? "The area could not be added.");
      return;
    }
    // The dedicated endpoint already persisted the record, so update shell state
    // through a lightweight reload to avoid a duplicate generic insert.
    const created = localEvidenceFromCreate(result);
    if (created) {
      setEvidence((current) => ({ ...current, [result.record!.id]: created }));
    }
    setSelectedId(result.record.id);
    setSearchResult(null);
    setQuery("");
    location.reload();
  }

  const ranked = useMemo(
    () =>
      [...areas].sort((a, b) => {
        const left = evidence[a.id]?.snapshot?.weighted_score;
        const right = evidence[b.id]?.snapshot?.weighted_score;
        if (left === null || left === undefined) return 1;
        if (right === null || right === undefined) return -1;
        return right - left;
      }),
    [areas, evidence],
  );
  const selected = areas.find((area) => area.id === selectedId) ?? areas[0];
  const selectedEvidence = selected ? evidence[selected.id] : null;

  return (
    <div className="section-stack">
      <section className="area-search-card">
        <div>
          <span className="eyebrow lime">Automatic official context</span>
          <h2>Search normally. Move Atlas handles the sources.</h2>
          <p>
            Choose a city, suburb, ZIP code, or neighborhood. No API key, source URL,
            command, or technical setup appears in your experience.
          </p>
        </div>
        <form onSubmit={search}>
          <label>
            <span className="sr-only">Search for an area</span>
            <input
              minLength={2}
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="City, suburb, ZIP, or neighborhood"
              required
              value={query}
            />
          </label>
          <button className="button light" disabled={searching}>
            {searching ? "Searching…" : "Search areas"}
          </button>
        </form>
      </section>

      {message ? (
        <p className="form-message error" role="alert">
          {message}
        </p>
      ) : null}
      {searchResult?.status === "unavailable" ? (
        <section className="provider-unavailable">
          <strong>Place search unavailable</strong>
          <p>{searchResult.message}</p>
          <small>
            Source checked: {searchResult.meta.provider} ·{" "}
            {new Date(searchResult.meta.checkedAt).toLocaleString()}
          </small>
        </section>
      ) : null}
      {searchResult?.status === "available" ? (
        <section className="search-results panel" aria-label="Place search results">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Select the intended place</span>
              <h3>{searchResult.data.length} provider matches</h3>
            </div>
            <span className="status-chip neutral">{searchResult.meta.provider}</span>
          </div>
          <div>
            {searchResult.data.map((place) => (
              <button
                disabled={!place.position || searching}
                key={place.id}
                onClick={() => add(place)}
                type="button"
              >
                <span>
                  <strong>{place.title}</strong>
                  <small>
                    {place.address.label ||
                      [place.address.city, place.address.stateCode]
                        .filter(Boolean)
                        .join(", ")}
                  </small>
                </span>
                <em>Add to shortlist →</em>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="area-layout">
        <aside className="area-ranking panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Your shortlist</span>
              <h3>Ranked only where evidence loads</h3>
            </div>
          </div>
          {ranked.length ? (
            <ol>
              {ranked.map((area, index) => {
                const snapshot = evidence[area.id]?.snapshot;
                return (
                  <li key={area.id}>
                    <button
                      className={selected?.id === area.id ? "selected" : ""}
                      onClick={() => setSelectedId(area.id)}
                      type="button"
                    >
                      <span>{index + 1}</span>
                      <div>
                        <strong>{String(area.user_label ?? area.canonical_name)}</strong>
                        <small>
                          {snapshot
                            ? `${snapshot.coverage_percent}% requested-category coverage`
                            : "Loading evidence…"}
                        </small>
                      </div>
                      <em>
                        {snapshot?.weighted_score === null ||
                        snapshot?.weighted_score === undefined
                          ? "—"
                          : Number(snapshot.weighted_score).toFixed(1)}
                      </em>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="empty-state compact">
              <strong>No areas shortlisted</strong>
              <p>Search above to build your first evidence panel.</p>
            </div>
          )}
        </aside>

        <section className="area-evidence panel">
          {!selected ? (
            <div className="empty-state">
              <strong>Choose a place to begin</strong>
              <p>
                Official data remains unavailable until an intended place is selected.
              </p>
            </div>
          ) : !selectedEvidence ? (
            <div className="evidence-loading" aria-busy="true">
              <div className="skeleton line short" />
              <div className="skeleton line title" />
              <div className="skeleton-grid">
                <div className="skeleton card" />
                <div className="skeleton card" />
              </div>
            </div>
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Evidence panel</span>
                  <h3>{String(selected.user_label ?? selected.canonical_name)}</h3>
                </div>
                <div>
                  <span
                    className={`status-chip ${
                      selectedEvidence.freshness === "stale"
                        ? "warning"
                        : "neutral"
                    }`}
                  >
                    {selectedEvidence.freshness === "stale"
                      ? "Stale official data"
                      : "Recently updated"}
                  </span>
                  <div className="score-badge">
                    <strong>
                      {selectedEvidence.snapshot?.weighted_score === null ||
                      selectedEvidence.snapshot?.weighted_score === undefined
                        ? "—"
                        : Number(selectedEvidence.snapshot.weighted_score).toFixed(1)}
                    </strong>
                    <span>available-data fit</span>
                  </div>
                </div>
              </div>

              {selectedEvidence.snapshot ? (
                <div className="coverage-meter">
                  <div>
                    <span>Reliable requested-category coverage</span>
                    <strong>{selectedEvidence.snapshot.coverage_percent}%</strong>
                  </div>
                  <i>
                    <span
                      style={{
                        width: `${selectedEvidence.snapshot.coverage_percent}%`,
                      }}
                    />
                  </i>
                </div>
              ) : null}

              <div className="evidence-grid">
                {selectedEvidence.metrics.map((metric) => (
                  <article
                    className={
                      metric.availability === "unavailable" ? "unavailable" : ""
                    }
                    key={metric.id}
                  >
                    <span>{metric.measure_name}</span>
                    <strong>
                      {metric.raw_display ??
                        "Reliable data is not currently available for this measure."}
                    </strong>
                    {metric.normalized_fit_score !== null ? (
                      <div>
                        <span>Normalized fit</span>
                        <b>{metric.normalized_fit_score}/100</b>
                      </div>
                    ) : null}
                    <small>{metric.geography_label || metric.coverage_note}</small>
                    <details>
                      <summary>Source and caveats</summary>
                      <p>
                        {metric.source_name || "No reliable source resolved"} ·{" "}
                        {metric.reference_period || "Period unavailable"}
                      </p>
                      <p>
                        Retrieved:{" "}
                        {metric.retrieved_at
                          ? new Date(metric.retrieved_at).toLocaleString()
                          : "Unavailable"}
                      </p>
                      <p>{metric.coverage_note}</p>
                      {metric.caveats.map((caveat) => (
                        <p key={caveat}>{caveat}</p>
                      ))}
                      {metric.source_url ? (
                        <a href={metric.source_url} rel="noreferrer" target="_blank">
                          Official source ↗
                        </a>
                      ) : null}
                    </details>
                  </article>
                ))}
              </div>

              <section className="personal-fit">
                <div>
                  <span className="eyebrow">Personal daily-life fit</span>
                  <strong>Keep your lived judgment separate</strong>
                  <p>
                    This rating is yours. It never becomes official evidence or a
                    reported-crime claim.
                  </p>
                </div>
                <select
                  aria-label="Personal daily-life fit"
                  defaultValue={
                    selected.personal_fit_score
                      ? Math.round(Number(selected.personal_fit_score) / 20)
                      : ""
                  }
                  onChange={(event) =>
                    actions.updateRecord("areas", selected.id, {
                      personal_fit_score: event.target.value
                        ? Number(event.target.value) * 20
                        : null,
                    })
                  }
                >
                  <option value="">Not rated</option>
                  <option value="1">1 · Poor fit</option>
                  <option value="2">2 · Some friction</option>
                  <option value="3">3 · Mixed</option>
                  <option value="4">4 · Strong fit</option>
                  <option value="5">5 · Excellent fit</option>
                </select>
              </section>
              <button
                className="text-action danger"
                onClick={() => actions.deleteRecord("areas", selected.id)}
                type="button"
              >
                Remove area from shortlist
              </button>
            </>
          )}
        </section>
      </div>

      <section className="trust-banner">
        <strong>Geography matters</strong>
        <p>
          City, county, tract, ZCTA, school, and agency boundaries are not
          interchangeable. Neighborhood searches may show containing city or county
          context and will say so. “Reported crime” is never a prediction of individual
          risk or a claim that a place is safe or unsafe.
        </p>
      </section>
    </div>
  );
}
