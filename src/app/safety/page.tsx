import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Safety & Data Disclaimer" };

export default function SafetyPage() {
  return (
    <LegalPage eyebrow="Safety & data" title="Know what the evidence can—and cannot—say.">
      <h2>Vehicle routing and clearance</h2>
      <p>
        HERE truck and vehicle restrictions are used when configured, including entered
        height, width, length, gross weight, axle weight, trailer, and clearance buffer.
        Coverage is not complete for every road. A route result or “no conflict found in
        available data” is never a guarantee.
      </p>
      <p>
        “Clearance data unavailable for this segment—manual verification required” means
        exactly that. Move Atlas will not invent a bridge name, clearance, restriction,
        or detour.
      </p>
      <h2>Weather and wind</h2>
      <p>
        U.S. route weather comes from the National Weather Service and is sampled at
        estimated route arrival times. Alerts retain their official event, severity,
        urgency, certainty, period, instructions, and source. Crosswind concern is a Move
        Atlas calculation from official wind data and route bearing—not an NWS safety
        rating.
      </p>
      <p>
        Forecasts change, point samples do not cover every mile, and NWS is not a
        road-closure provider. Follow official warnings, transportation restrictions, and
        closures.
      </p>
      <h2>Area Intelligence</h2>
      <p>
        Measures retain provider, geography, reference period, retrieval time, coverage,
        and caveats. Missing categories are excluded from the score denominator and never
        converted to zero. City, county, tract, ZCTA, school, and police-agency boundaries
        are not interchangeable.
      </p>
      <h2>Reported crime and schools</h2>
      <p>
        When reliable coverage becomes available, the product uses “reported crime” or
        “reported incidents,” shows the agency and period, and never predicts personal
        risk or calls an area safe or unsafe. School directory context is not a universal
        performance score; official state report cards remain the performance source.
      </p>
      <h2>Fuel, tolls, listings, and assistant output</h2>
      <p>
        Fuel costs are labeled as user-entered or regional estimates unless a licensed
        price provider is configured. Toll details are best-effort provider data. Listing
        facts remain manual without authorized access. Assistant text never overrides
        provider facts, official alerts, or deterministic calculations.
      </p>
    </LegalPage>
  );
}
