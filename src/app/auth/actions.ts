"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = {
  error?: string;
  message?: string;
};

const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z
    .string()
    .min(10, "Use at least 10 characters.")
    .max(128, "Password is too long."),
});

function safeNextPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "/app";
  if (!value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}

export async function signIn(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "Account service is temporarily unavailable." };

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Email or password was not accepted." };

  redirect(safeNextPath(formData.get("next")));
}

export async function signUp(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentialsSchema
    .extend({
      displayName: z.string().trim().min(2).max(80),
    })
    .safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
      displayName: formData.get("displayName"),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "Account service is temporarily unavailable." };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${appUrl}/auth/callback?next=/setup`,
    },
  });

  if (error) return { error: "We could not create that account. Try again." };
  if (data.session) redirect("/setup");
  redirect("/check-email");
}

export async function requestPasswordReset(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = z.string().trim().email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  if (!supabase) return { error: "Account service is temporarily unavailable." };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${appUrl}/auth/callback?next=/update-password`,
  });

  return {
    message:
      "If an account exists for that address, a reset link is on its way.",
  };
}

export async function updatePassword(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const password = z.string().min(10).max(128).safeParse(formData.get("password"));
  if (!password.success) {
    return { error: "Use a password between 10 and 128 characters." };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "Account service is temporarily unavailable." };
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) return { error: "That password could not be updated." };
  redirect("/app");
}

export async function signOut() {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/");
}
