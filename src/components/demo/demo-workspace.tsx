"use client";

import Link from "next/link";
import { useState } from "react";

const sampleSections = {
  overview: {
    title: "Portland is coming into focus.",
    text: "Curated sample move for Maya Bennett · Austin to Portland · October 15, 2026.",
  },
  roadmap: {
    title: "A sample plan you can move through.",
    text: "12 of 24 demonstration tasks complete. These records are sample-only and are never mixed with real accounts.",
  },
  areas: {
    title: "Three sample areas, clearly labeled.",
    text: "Sellwood-Moreland, Alberta Arts, and Beaverton illustrate the comparison workflow. Values shown here are curated sample content, not current official data.",
  },
  homes: {
    title: "A mixed-property shortlist.",
    text: "Sample apartment, condo, and townhome cards demonstrate the approved Homes & Rentals workflow.",
  },
  route: {
    title: "Route Command Center preview.",
    text: "This demo route is schematic sample content. Real accounts use HERE and NWS only when operator credentials are configured.",
  },
  tools: {
    title: "Packing through settling in.",
    text: "Sample boxes, mover quotes, utilities, address changes, document metadata, and first-90-day tasks live in this isolated workspace.",
  },
} as const;

export function DemoWorkspace() {
  const [section, setSection] = useState<keyof typeof sampleSections>("overview");
  const current = sampleSections[section];

  return (
    <main className="demo-shell" id="main-content">
      <aside>
        <Link className="brand-lockup inverse" href="/">
          <span className="brand-mark">M</span>
          <span>Move Atlas</span>
        </Link>
        <span className="demo-label">Curated sample workspace</span>
        <nav>
          {Object.keys(sampleSections).map((key) => (
            <button
              className={section === key ? "active" : ""}
              key={key}
              onClick={() => setSection(key as keyof typeof sampleSections)}
              type="button"
            >
              {key[0].toUpperCase() + key.slice(1)}
            </button>
          ))}
        </nav>
        <Link className="button light wide" href="/sign-up">
          Create a real account
        </Link>
      </aside>
      <div className="demo-main">
        <header>
          <div>
            <span>Austin, TX → Portland, OR</span>
            <strong>Maya’s Portland move</strong>
          </div>
          <span className="status-chip warning">Sample data · not live</span>
        </header>
        <section>
          <span className="eyebrow">Demo workspace</span>
          <h1>{current.title}</h1>
          <p className="lede">{current.text}</p>
          {section === "overview" ? (
            <>
              <div className="demo-hero-card">
                <div>
                  <span className="eyebrow lime">Sample readiness</span>
                  <h2>Every moving part in one calm view.</h2>
                  <p>
                    Couple + dog · renting · long-distance moving truck · October 2026
                  </p>
                </div>
                <div className="readiness-ring" style={{ "--progress": 68 } as React.CSSProperties}>
                  <strong>68%</strong>
                  <span>sample</span>
                </div>
              </div>
              <div className="metric-grid four">
                {[
                  ["Roadmap", "12 / 24", "sample tasks complete"],
                  ["Areas", "3", "sample shortlist"],
                  ["Homes", "3", "mixed property types"],
                  ["Budget", "$8,940", "sample estimates"],
                ].map(([label, value, helper]) => (
                  <article className="metric-card" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <small>{helper}</small>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="demo-section-card">
              <span className="status-chip warning">Sample content</span>
              <div className="demo-faux-list">
                {[1, 2, 3].map((item) => (
                  <article key={item}>
                    <i />
                    <div>
                      <strong>
                        {section === "areas"
                          ? ["Sellwood-Moreland", "Alberta Arts", "Beaverton"][item - 1]
                          : section === "homes"
                            ? ["Garden apartment", "Pearl District condo", "Beaverton townhome"][item - 1]
                            : `Demonstration ${section} item ${item}`}
                      </strong>
                      <span>Clearly identified sample record</span>
                    </div>
                  </article>
                ))}
              </div>
              <p className="data-note">
                Open a real account to create private records and connect configured
                production providers. Demo records are immutable and isolated.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
