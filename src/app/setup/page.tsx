import { redirect } from "next/navigation";
import { GuidedSetup } from "@/components/setup/guided-setup";
import { createClient } from "@/lib/supabase/server";

export default async function SetupPage() {
  const supabase = await createClient();
  if (!supabase) redirect("/sign-in");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const defaultName =
    typeof user.user_metadata.display_name === "string"
      ? user.user_metadata.display_name
      : "";

  return <GuidedSetup defaultName={defaultName} />;
}
