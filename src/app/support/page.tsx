import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Support" };

export default function SupportPage() {
  return (
    <LegalPage eyebrow="Support" title="Tell us what is getting in the way.">
      <h2>Account access</h2>
      <p>
        Use the password-reset link on the sign-in page. For security, support cannot see
        or recover your password.
      </p>
      <h2>Provider or route problem</h2>
      <p>
        Include the visible provider name, retrieval time, unavailable-state wording, and
        route-plan ID if shown. Do not send passwords, provider keys, government IDs,
        payment details, document contents, or unnecessary exact-address information.
      </p>
      <h2>Support channel</h2>
      <p>
        Move Atlas uses GitHub Issues for reproducible product and technical
        reports.
      </p>
      <a
        className="button primary"
        href="https://github.com/CasBen02/move-atlas-public-test/issues"
        rel="noreferrer"
        target="_blank"
      >
        Open a support issue ↗
      </a>
      <p>
        For a safety emergency, severe-weather event, or active road hazard, use official
        emergency and transportation channels—not a software issue.
      </p>
      <Link href="/safety">Review safety and data limitations →</Link>
    </LegalPage>
  );
}
