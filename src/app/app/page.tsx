import { redirect } from "next/navigation";
import { getActiveMoveId } from "@/lib/data/workspace";

export default async function AppIndexPage() {
  const result = await getActiveMoveId();
  if (!result.authenticated) redirect("/sign-in");
  if (!result.moveId) redirect("/setup");
  redirect(`/app/${result.moveId}/overview`);
}
