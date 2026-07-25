import type { Metadata } from "next";
import { signUp } from "@/app/auth/actions";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <AuthShell>
      <AuthForm action={signUp} mode="sign-up" />
    </AuthShell>
  );
}
