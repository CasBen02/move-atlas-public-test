"use client";

export default function WorkspaceError({
  reset,
}: {
  reset: () => void;
}) {
  return (
    <main className="center-state" id="main-content">
      <span className="eyebrow">Recoverable error</span>
      <h1>Your move is still saved.</h1>
      <p>
        This view could not be loaded. The provider or account service may be
        temporarily unavailable.
      </p>
      <button className="button primary" onClick={reset} type="button">
        Try again
      </button>
    </main>
  );
}
