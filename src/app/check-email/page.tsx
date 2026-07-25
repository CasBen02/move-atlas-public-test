import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";

export default function CheckEmailPage() {
  return (
    <AuthShell>
      <div className="auth-form">
        <span className="eyebrow">Check your inbox</span>
        <h1>Confirm your email to open your atlas.</h1>
        <p className="lede">
          For your privacy, we need to verify the address before saving move plans.
          The link will return you to guided setup.
        </p>
        <Link className="button secondary wide" href="/sign-in">
          Return to sign in
        </Link>
      </div>
    </AuthShell>
  );
}
