import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Privacy" title="Your move data is yours.">
      <h2>What Move Atlas stores</h2>
      <p>
        Signed-in accounts store the profile, move plans, preferences, tasks, area
        shortlist, manually saved homes, budget items, packing boxes, mover quotes,
        utilities, address-change items, checklist metadata, route profiles and saved
        route facts, assistant-visible messages if retained, and settling-in tasks that
        you choose to create.
      </p>
      <h2>What Move Atlas intentionally does not store</h2>
      <p>
        Move Atlas does not store your password, provider credentials, government ID
        numbers, financial account numbers, payment-card data, or document file
        contents. Supabase Auth handles password authentication. The Document Center is
        checklist metadata only for this launch.
      </p>
      <h2>External providers</h2>
      <p>
        Server routes may send the minimum coordinates, vehicle profile, time, or place
        context required to HERE, the National Weather Service, and official public-data
        providers. Provider credentials remain server-side. Move Atlas does not require
        customers to supply keys.
      </p>
      <h2>Local-data import</h2>
      <p>
        A signed-in customer may opt into a one-time import from the earlier browser
        browser-local version. The import strips local passwords, keys, sample route results, generated
        provider facts, and demo records. The browser copy is not deleted automatically.
      </p>
      <h2>Security and access</h2>
      <p>
        User-owned database rows are protected by row-level security and composite
        ownership relationships. Protected server routes verify the current Supabase
        user, apply same-origin checks to mutations, validate inputs, and rate-limit
        requests.
      </p>
      <h2>Export and deletion</h2>
      <p>
        Account settings provide a sanitized JSON export and permanent account deletion.
        Deletion requires current-password verification and cascades through user-owned
        records. Provider caches and security counters do not appear in exports.
      </p>
      <h2>Cookies and analytics</h2>
      <p>
        Move Atlas uses the cookies required for authenticated sessions. It does not add
        advertising cookies or invasive analytics. Privacy-conscious error monitoring is
        active only when the application owner configures it.
      </p>
    </LegalPage>
  );
}
