import { describe, expect, it } from "vitest";

import {
  assertWorkspaceSectionsLoaded,
  WorkspaceLoadError,
} from "../../src/lib/data/workspace-result";

describe("workspace hydration results", () => {
  it("allows successful empty sections", () => {
    expect(() =>
      assertWorkspaceSectionsLoaded([
        { section: "tasks", error: null },
        { section: "properties", error: null },
      ]),
    ).not.toThrow();
  });

  it("surfaces failed sections instead of treating them as empty", () => {
    let caught: unknown;
    try {
      assertWorkspaceSectionsLoaded([
        { section: "tasks", error: null },
        { section: "properties", error: { code: "permission_denied" } },
        { section: "utilities", error: new Error("database unavailable") },
      ]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WorkspaceLoadError);
    expect(caught).toMatchObject({
      code: "WORKSPACE_RECORD_QUERY_FAILED",
      failedSections: ["properties", "utilities"],
    });
    expect((caught as Error).message).not.toContain("permission_denied");
    expect((caught as Error).message).not.toContain("database unavailable");
  });
});
