"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthActionState } from "@/app/auth/actions";

type AuthFormProps = {
  action: (
    state: AuthActionState,
    formData: FormData,
  ) => Promise<AuthActionState>;
  mode: "sign-in" | "sign-up" | "reset" | "update";
  next?: string;
};

const copy = {
  "sign-in": {
    eyebrow: "Welcome back",
    title: "Pick up where your move left off.",
    submit: "Sign in",
  },
  "sign-up": {
    eyebrow: "Create your atlas",
    title: "A calmer move starts with the right questions.",
    submit: "Create account",
  },
  reset: {
    eyebrow: "Password reset",
    title: "We’ll help you get back to your move.",
    submit: "Send reset link",
  },
  update: {
    eyebrow: "Choose a new password",
    title: "Make it memorable to you and difficult to guess.",
    submit: "Save new password",
  },
} as const;

export function AuthForm({ action, mode, next }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const details = copy[mode];
  const needsEmail = mode !== "update";
  const needsPassword = mode === "sign-in" || mode === "sign-up" || mode === "update";

  return (
    <form className="auth-form" action={formAction}>
      <div>
        <span className="eyebrow">{details.eyebrow}</span>
        <h1>{details.title}</h1>
      </div>

      {mode === "sign-up" ? (
        <label>
          Your name
          <input
            autoComplete="name"
            name="displayName"
            required
            minLength={2}
            maxLength={80}
            placeholder="Alex Morgan"
          />
        </label>
      ) : null}

      {needsEmail ? (
        <label>
          Email
          <input
            autoComplete="email"
            inputMode="email"
            name="email"
            required
            type="email"
            placeholder="you@example.com"
          />
        </label>
      ) : null}

      {needsPassword ? (
        <label>
          {mode === "update" ? "New password" : "Password"}
          <input
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            name="password"
            required
            minLength={10}
            maxLength={128}
            type="password"
          />
          {mode === "sign-up" || mode === "update" ? (
            <small>At least 10 characters. Move Atlas never stores your password.</small>
          ) : null}
        </label>
      ) : null}

      {next ? <input name="next" type="hidden" value={next} /> : null}

      {state.error ? (
        <p className="form-message error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="form-message success" role="status">
          {state.message}
        </p>
      ) : null}

      <button className="button primary wide" disabled={pending} type="submit">
        {pending ? "One moment…" : details.submit}
      </button>

      {mode === "sign-in" ? (
        <div className="auth-links">
          <Link href="/reset-password">Forgot password?</Link>
          <Link href="/sign-up">Create an account</Link>
        </div>
      ) : null}
      {mode === "sign-up" || mode === "reset" ? (
        <p className="muted centered">
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </p>
      ) : null}
    </form>
  );
}
