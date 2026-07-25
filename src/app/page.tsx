import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const features = [
  {
    number: "01",
    title: "A roadmap shaped by your real move",
    text: "Seven guided setup steps turn household, timing, property path, budget, mobility, and priorities into the right workspace.",
  },
  {
    number: "02",
    title: "Evidence, never a black box",
    text: "Area measures keep their source, geography, reference year, retrieval time, coverage, and caveats. Missing stays missing.",
  },
  {
    number: "03",
    title: "Routes built around the actual vehicle",
    text: "HERE car and truck routing uses entered dimensions, trailer, weight, clearances, avoidances, and real route geometry.",
  },
  {
    number: "04",
    title: "Every operational detail held together",
    text: "Homes, budget, packing, movers, utilities, address changes, documents, and the first 90 days live beside the plan.",
  },
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  return (
    <main className="marketing" id="main-content">
      <nav className="marketing-nav" aria-label="Primary">
        <Link className="brand-lockup" href="/">
          <span className="brand-mark">M</span>
          <span>Move Atlas</span>
        </Link>
        <div>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#trust">Trust</Link>
          <Link href="/demo">Demo workspace</Link>
        </div>
        <div>
          {user ? (
            <Link className="button primary compact" href="/app">
              Open Move Atlas
            </Link>
          ) : (
            <>
              <Link className="text-link" href="/sign-in">
                Sign in
              </Link>
              <Link className="button primary compact" href="/sign-up">
                Create account
              </Link>
            </>
          )}
        </div>
      </nav>

      <section className="marketing-hero">
        <div className="hero-rings" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>↗</span>
        </div>
        <div className="hero-copy">
          <span className="eyebrow">Every part of the move, held together</span>
          <h1>
            Move with a plan that feels <em>like yours.</em>
          </h1>
          <p>
            Compare places, shortlist every kind of home, build a vehicle-aware route,
            track the budget, pack the boxes, and settle in—without losing the context
            behind a single decision.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href={user ? "/app" : "/sign-up"}>
              {user ? "Open your move" : "Create your private atlas"} <span>→</span>
            </Link>
            <Link className="button secondary" href="/demo">
              Explore the sample workspace
            </Link>
          </div>
          <small>
            Private accounts · Multiple move plans · Desktop and mobile · No user API
            keys
          </small>
        </div>

        <div className="product-preview" aria-label="Move Atlas interface preview">
          <aside>
            <span className="brand-lockup inverse">
              <span className="brand-mark">M</span>
              <span>Move Atlas</span>
            </span>
            {["Overview", "My move", "Roadmap", "Route command", "Area intelligence", "Homes & rentals", "Budget", "Move tools"].map(
              (item, index) => (
                <span className={index === 0 ? "active" : ""} key={item}>
                  <i>{["⌂", "↗", "✓", "⌁", "◎", "⌑", "$", "▣"][index]}</i>
                  {item}
                </span>
              ),
            )}
          </aside>
          <div>
            <header>
              <span>Austin, TX → Portland, OR</span>
              <em>Sample workspace</em>
            </header>
            <section>
              <span className="eyebrow">Your move at a glance</span>
              <h2>One calm view of what matters next.</h2>
              <div className="preview-hero">
                <div>
                  <span>Sample move readiness</span>
                  <strong>Portland is coming into focus.</strong>
                  <p>Curated demonstration data—not live provider information.</p>
                </div>
                <i>68%</i>
              </div>
              <div className="preview-metrics">
                <article>
                  <span>Roadmap</span>
                  <strong>12 / 24</strong>
                </article>
                <article>
                  <span>Areas</span>
                  <strong>3</strong>
                </article>
                <article>
                  <span>Homes</span>
                  <strong>3</strong>
                </article>
              </div>
              <div className="preview-panels">
                <article>
                  <span>Next actions</span>
                  <strong>Confirm the moving vehicle</strong>
                  <small>Sample task · route</small>
                </article>
                <article>
                  <span>Housing guardrail</span>
                  <strong>$2,600 / mo</strong>
                  <small>User-entered sample</small>
                </article>
              </div>
            </section>
          </div>
        </div>
      </section>

      <section className="marketing-intro" id="how-it-works">
        <span className="eyebrow">Organized around real life</span>
        <h2>The move is not one checklist. Your app should not pretend it is.</h2>
        <p>
          Move Atlas keeps the relationship between place, home, money, route,
          household, timing, and moving-day execution visible all the way through.
        </p>
      </section>

      <section className="feature-editorial">
        {features.map((feature) => (
          <article key={feature.number}>
            <span>{feature.number}</span>
            <div>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="trust-section" id="trust">
        <div>
          <span className="eyebrow lime">Trust is a product feature</span>
          <h2>Facts keep their source. Gaps stay visible.</h2>
          <p>
            Move Atlas does not call sample, estimated, stale, cached, AI-generated, or
            unavailable information live. Critical routing and weather decisions never
            become safety guarantees.
          </p>
          <Link className="button light" href="/safety">
            Read the safety and data approach
          </Link>
        </div>
        <div className="trust-list">
          {[
            ["Private by default", "Supabase authentication, per-user row security, and server authorization."],
            ["Operator-managed providers", "No keys, tokens, or source setup in the customer experience."],
            ["Official weather", "ETA-aware National Weather Service forecasts and official alerts for U.S. routes."],
            ["Transparent area context", "Census geography and vintage stay attached; unsupported categories remain unavailable."],
            ["No listing-site scraping", "User-saved homes remain manual until an authorized provider is configured."],
          ].map(([title, text]) => (
            <article key={title}>
              <i>✓</i>
              <div>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-cta">
        <div className="cta-rings" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span className="eyebrow lime">Make the next place feel like yours</span>
        <h2>Start with the questions that shape the whole move.</h2>
        <p>
          Your first plan begins with guided setup and stays available across signed-in
          sessions.
        </p>
        <Link className="button light" href={user ? "/app" : "/sign-up"}>
          {user ? "Open Move Atlas" : "Create your account"} →
        </Link>
      </section>

      <footer className="marketing-footer">
        <Link className="brand-lockup" href="/">
          <span className="brand-mark">M</span>
          <span>Move Atlas</span>
        </Link>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/safety">Safety & data</Link>
          <Link href="/support">Support</Link>
        </div>
        <span>© {new Date().getFullYear()} Move Atlas</span>
      </footer>
    </main>
  );
}
