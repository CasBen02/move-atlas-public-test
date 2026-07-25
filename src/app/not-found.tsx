import Link from "next/link";

export default function NotFound() {
  return (
    <main className="center-state" id="main-content">
      <span className="brand-mark large">M</span>
      <span className="eyebrow">Page not found</span>
      <h1>This path is not in your atlas.</h1>
      <p>Return to Move Atlas and choose a saved move plan.</p>
      <Link className="button primary" href="/app">
        Open Move Atlas
      </Link>
    </main>
  );
}
