import { notFound, redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getWorkspace } from "@/lib/data/workspace";

const sections = new Set([
  "overview",
  "move",
  "roadmap",
  "route",
  "areas",
  "homes",
  "budget",
  "career",
  "tools",
  "documents",
  "assistant",
  "account",
]);

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ moveId: string; section?: string[] }>;
}) {
  const { moveId, section: routeParts } = await params;
  const section = routeParts?.[0] ?? "overview";
  if (!sections.has(section)) redirect(`/app/${moveId}/overview`);

  const workspace = await getWorkspace(moveId);
  if (!workspace) notFound();

  return <WorkspaceShell initial={workspace} section={section} />;
}
