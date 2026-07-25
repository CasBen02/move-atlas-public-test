import type { Metadata } from "next";
import { requestPasswordReset } from "@/app/auth/actions";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <AuthForm action={requestPasswordReset} mode="reset" />
    </AuthShell>
  );
}
