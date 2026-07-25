import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Terms of Use" };

export default function TermsPage() {
  return (
    <LegalPage eyebrow="Terms" title="Use Move Atlas as decision support.">
      <h2>The service</h2>
      <p>
        Move Atlas helps organize moving plans and display provider-supplied or
        user-entered context. It is not a moving company, broker, real-estate service,
        insurer, weather authority, transportation agency, school authority, or
        professional commercial-routing system.
      </p>
      <h2>Your account</h2>
      <p>
        You are responsible for accurate account information, safeguarding access, and
        entering truthful vehicle dimensions. Do not store passwords, payment data,
        government IDs, financial account numbers, or document contents in free-text
        fields.
      </p>
      <h2>Routes and safety</h2>
      <p>
        No route is guaranteed safe, legal, open, or suitable. Always verify restrictions,
        clearances, closures, conditions, and vehicle requirements with official
        transportation agencies, posted signage, the rental company, current official
        alerts, and professional commercial-routing tools.
      </p>
      <h2>Area and property information</h2>
      <p>
        Geographic measures describe the stated statistical or agency geography and
        period—not a specific household, neighborhood, property, or individual. Reported
        crime is not a safety determination. Manually saved properties are not a claim of
        current availability. Move Atlas does not scrape Zillow or other listing sites.
      </p>
      <h2>Availability</h2>
      <p>
        External providers can fail, change, or omit information. Move Atlas may show
        stale or unavailable states and will not replace provider failure with invented
        facts.
      </p>
      <h2>Acceptable use</h2>
      <p>
        Do not attempt to bypass authentication, access another user’s records, abuse
        provider limits, inject malicious content, reverse engineer credentials, or use
        Move Atlas for unlawful activity.
      </p>
    </LegalPage>
  );
}
