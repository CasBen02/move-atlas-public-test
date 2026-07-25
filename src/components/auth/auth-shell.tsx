import Link from "next/link";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell" id="main-content">
      <section className="auth-brand-panel">
        <Link className="brand-lockup inverse" href="/" aria-label="Move Atlas home">
          <span className="brand-mark">M</span>
          <span>Move Atlas</span>
        </Link>
        <div className="auth-brand-copy">
          <span className="eyebrow lime">Your move, held together</span>
          <h2>Every decision, deadline, route, and box—in one calm place.</h2>
          <p>
            Private cloud accounts keep each move plan isolated and available across
            your devices.
          </p>
        </div>
        <p className="auth-trust">
          No provider keys in your browser. No listing-site scraping. No invented
          “live” facts.
        </p>
      </section>
      <section className="auth-form-panel">
        <Link className="back-link" href="/">
          ← Move Atlas home
        </Link>
        {children}
      </section>
    </main>
  );
}
