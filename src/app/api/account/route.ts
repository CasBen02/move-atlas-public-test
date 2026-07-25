import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const deleteSchema = z.object({
  password: z.string().min(10).max(128),
  confirmation: z.literal("DELETE"),
});

export async function DELETE(request: NextRequest) {
  const auth = await authorizeApiRequest(request, { mutation: true, limit: 3 });
  if (!auth.ok) return auth.response;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !auth.user.email) {
    return noStoreJson(
      { error: "Password and the exact confirmation DELETE are required." },
      { status: 400 },
    );
  }

  const { error: reauthenticationError } =
    await auth.supabase.auth.signInWithPassword({
      email: auth.user.email,
      password: parsed.data.password,
    });
  if (reauthenticationError) {
    return noStoreJson({ error: "Password verification failed." }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return noStoreJson(
      { error: "Account deletion is temporarily unavailable." },
      { status: 503 },
    );
  }

  const { error } = await admin.auth.admin.deleteUser(auth.user.id);
  if (error) {
    return noStoreJson(
      { error: "Account deletion could not be completed." },
      { status: 503 },
    );
  }

  return noStoreJson({ deleted: true });
}
