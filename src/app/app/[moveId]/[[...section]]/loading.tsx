export default function WorkspaceLoading() {
  return (
    <main className="loading-shell" id="main-content" aria-busy="true">
      <aside className="loading-sidebar skeleton" />
      <section className="loading-content">
        <div className="skeleton line short" />
        <div className="skeleton line title" />
        <div className="skeleton card" />
        <div className="skeleton-grid">
          <div className="skeleton card" />
          <div className="skeleton card" />
        </div>
      </section>
    </main>
  );
}
