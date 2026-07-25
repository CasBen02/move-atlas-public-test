import Link from "next/link";

export function LegalPage({
  eyebrow,
  title,
  updated = "July 24, 2026",
  children,
}: {
  eyebrow: string;
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="legal-shell" id="main-content">
      <header>
        <Link className="brand-lockup inverse" href="/">
          <span className="brand-mark">M</span>
          <span>Move Atlas</span>
        </Link>
        <Link href="/">← Home</Link>
      </header>
      <article>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="legal-updated">Last updated {updated}</p>
        {children}
      </article>
      <footer>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/safety">Safety & data</Link>
        <Link href="/support">Support</Link>
      </footer>
    </main>
  );
}
