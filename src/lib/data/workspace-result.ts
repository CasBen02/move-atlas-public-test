export type WorkspaceSectionQuery = {
  section: string;
  error: unknown;
};

export class WorkspaceLoadError extends Error {
  readonly code = "WORKSPACE_RECORD_QUERY_FAILED";
  readonly failedSections: string[];

  constructor(failedSections: string[]) {
    super("One or more workspace sections could not be loaded.");
    this.name = "WorkspaceLoadError";
    this.failedSections = [...failedSections];
  }
}

/**
 * Prevents an authorization, migration, or database outage from being rendered
 * as a trustworthy empty state. Provider/database details remain server-side.
 */
export function assertWorkspaceSectionsLoaded(
  results: readonly WorkspaceSectionQuery[],
) {
  const failedSections = results
    .filter((result) => result.error)
    .map((result) => result.section);
  if (failedSections.length) throw new WorkspaceLoadError(failedSections);
}
