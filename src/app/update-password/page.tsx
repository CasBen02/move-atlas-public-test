import type { Metadata } from "next";
import { updatePassword } from "@/app/auth/actions";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Update password" };

export default function UpdatePasswordPage() {
  return (
    <AuthShell>
      <AuthForm action={updatePassword} mode="update" />
    </AuthShell>
  );
}
