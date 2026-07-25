"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const propertyTypes = [
  "Apartment",
  "Condo",
  "Townhome",
  "Single-family",
  "Multifamily",
  "Co-living",
  "New build",
  "Temporary",
];

const priorityOptions = [
  "Housing cost",
  "Reported crime context",
  "Shorter commute",
  "Walkable daily life",
  "Schools",
  "Career",
  "Outdoor access",
  "Community",
];

const dailyNeedOptions = [
  "Groceries",
  "Healthcare",
  "Public transit",
  "Parks",
  "Childcare",
  "Pet care",
  "Accessible services",
  "Airport access",
];

type SetupState = {
  name: string;
  personName: string;
  household: string;
  originLabel: string;
  destinationLabel: string;
  moveType: "local" | "long-distance" | "international" | "undecided";
  targetDate: string;
  timeframe: string;
  housingIntent: "rent" | "buy" | "either" | "temporary";
  housingMax: string;
  savings: string;
  moveFundTarget: string;
  propertyTypes: string[];
  bedrooms: string;
  bathrooms: string;
  pets: string[];
  accessibilityNeeds: string[];
  commuteMode: string;
  maxCommuteMinutes: string;
  dailyNeeds: string[];
  priorityTags: string[];
  weights: {
    housing: number;
    reportedCrime: number;
    mobility: number;
    market: number;
    dailyLife: number;
  };
};

function toggle(list: string[], item: string) {
  return list.includes(item)
    ? list.filter((value) => value !== item)
    : [...list, item];
}

function dollarsToCents(value: string) {
  const amount = Number(value.replace(/[,$\s]/g, ""));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : 0;
}

export function GuidedSetup({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<SetupState>({
    name: "My move",
    personName: defaultName,
    household: "Just me",
    originLabel: "",
    destinationLabel: "",
    moveType: "long-distance",
    targetDate: "",
    timeframe: "I have a target date",
    housingIntent: "rent",
    housingMax: "",
    savings: "",
    moveFundTarget: "",
    propertyTypes: ["Apartment"],
    bedrooms: "1",
    bathrooms: "1",
    pets: [],
    accessibilityNeeds: [],
    commuteMode: "Driving",
    maxCommuteMinutes: "30",
    dailyNeeds: [],
    priorityTags: ["Housing cost"],
    weights: {
      housing: 80,
      reportedCrime: 60,
      mobility: 55,
      market: 45,
      dailyLife: 70,
    },
  });

  const summary = useMemo(
    () =>
      `${state.originLabel || "Your origin"} → ${state.destinationLabel || "your destination"}`,
    [state.originLabel, state.destinationLabel],
  );

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  function continueSetup() {
    setError("");
    if (step === 0 && (!state.personName.trim() || !state.name.trim())) {
      setError("Add your name and a name for this move plan.");
      return;
    }
    if (
      step === 1 &&
      (!state.originLabel.trim() || !state.destinationLabel.trim())
    ) {
      setError("Add both a starting place and a destination.");
      return;
    }
    if (step === 2 && state.propertyTypes.length === 0) {
      setError("Choose at least one home type to include.");
      return;
    }
    setStep((value) => value + 1);
  }

  const steps = [
    {
      eyebrow: "01 · Your household",
      title: "Who is this move organized around?",
      content: (
        <div className="form-grid two">
          <label>
            Your name
            <input
              value={state.personName}
              onChange={(event) =>
                setState({ ...state, personName: event.target.value })
              }
              maxLength={80}
            />
          </label>
          <label>
            Move plan name
            <input
              value={state.name}
              onChange={(event) => setState({ ...state, name: event.target.value })}
              maxLength={80}
            />
          </label>
          <label className="full">
            Household
            <select
              value={state.household}
              onChange={(event) =>
                setState({ ...state, household: event.target.value })
              }
            >
              <option>Just me</option>
              <option>Couple</option>
              <option>Family with children</option>
              <option>Roommates</option>
              <option>Multigenerational household</option>
              <option>Other household</option>
            </select>
          </label>
        </div>
      ),
    },
    {
      eyebrow: "02 · Direction and timing",
      title: "Where are you going, and how firm is the date?",
      content: (
        <div className="form-grid two">
          <label>
            Starting city or address
            <input
              value={state.originLabel}
              onChange={(event) =>
                setState({ ...state, originLabel: event.target.value })
              }
              placeholder="Austin, TX"
              maxLength={200}
            />
          </label>
          <label>
            Destination city or address
            <input
              value={state.destinationLabel}
              onChange={(event) =>
                setState({ ...state, destinationLabel: event.target.value })
              }
              placeholder="Portland, OR"
              maxLength={200}
            />
          </label>
          <label>
            Move distance
            <select
              value={state.moveType}
              onChange={(event) =>
                setState({
                  ...state,
                  moveType: event.target.value as SetupState["moveType"],
                })
              }
            >
              <option value="local">Local</option>
              <option value="long-distance">Long-distance / out of state</option>
              <option value="international">International</option>
              <option value="undecided">Still deciding</option>
            </select>
          </label>
          <label>
            Target move date
            <input
              value={state.targetDate}
              onChange={(event) =>
                setState({ ...state, targetDate: event.target.value })
              }
              type="date"
            />
          </label>
        </div>
      ),
    },
    {
      eyebrow: "03 · Property path",
      title: "What kind of next home are you moving toward?",
      content: (
        <>
          <div className="choice-grid">
            {(["rent", "buy", "either", "temporary"] as const).map((intent) => (
              <button
                className={`choice-card ${state.housingIntent === intent ? "selected" : ""}`}
                key={intent}
                onClick={() => setState({ ...state, housingIntent: intent })}
                type="button"
              >
                <strong>{intent[0].toUpperCase() + intent.slice(1)}</strong>
                <span>
                  {intent === "rent" && "Leases, deposits, utilities, and timing."}
                  {intent === "buy" && "Search, offers, financing, and closing."}
                  {intent === "either" && "Compare both paths without committing yet."}
                  {intent === "temporary" && "Bridge housing, furnished stays, and storage."}
                </span>
              </button>
            ))}
          </div>
          <fieldset>
            <legend>Home types to include</legend>
            <div className="chip-picker">
              {propertyTypes.map((item) => (
                <label className="check-chip" key={item}>
                  <input
                    checked={state.propertyTypes.includes(item)}
                    onChange={() =>
                      setState({
                        ...state,
                        propertyTypes: toggle(state.propertyTypes, item),
                      })
                    }
                    type="checkbox"
                  />
                  {item}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      ),
    },
    {
      eyebrow: "04 · Home and budget",
      title: "Set useful guardrails, not false precision.",
      content: (
        <div className="form-grid three">
          <label>
            Monthly housing ceiling
            <span className="money-input">
              <span>$</span>
              <input
                inputMode="decimal"
                value={state.housingMax}
                onChange={(event) =>
                  setState({ ...state, housingMax: event.target.value })
                }
                placeholder="2,400"
              />
            </span>
          </label>
          <label>
            Savings available
            <span className="money-input">
              <span>$</span>
              <input
                inputMode="decimal"
                value={state.savings}
                onChange={(event) =>
                  setState({ ...state, savings: event.target.value })
                }
                placeholder="12,000"
              />
            </span>
          </label>
          <label>
            Move fund target
            <span className="money-input">
              <span>$</span>
              <input
                inputMode="decimal"
                value={state.moveFundTarget}
                onChange={(event) =>
                  setState({ ...state, moveFundTarget: event.target.value })
                }
                placeholder="8,000"
              />
            </span>
          </label>
          <label>
            Bedrooms
            <input
              min="0"
              max="20"
              type="number"
              value={state.bedrooms}
              onChange={(event) => setState({ ...state, bedrooms: event.target.value })}
            />
          </label>
          <label>
            Bathrooms
            <input
              min="0"
              max="20"
              step="0.5"
              type="number"
              value={state.bathrooms}
              onChange={(event) =>
                setState({ ...state, bathrooms: event.target.value })
              }
            />
          </label>
        </div>
      ),
    },
    {
      eyebrow: "05 · Daily life",
      title: "What needs to work once the boxes are open?",
      content: (
        <>
          <div className="form-grid two">
            <label>
              Usual commute mode
              <select
                value={state.commuteMode}
                onChange={(event) =>
                  setState({ ...state, commuteMode: event.target.value })
                }
              >
                <option>Driving</option>
                <option>Transit</option>
                <option>Walking</option>
                <option>Cycling</option>
                <option>Remote work</option>
                <option>Mixed</option>
              </select>
            </label>
            <label>
              Maximum preferred commute
              <span className="suffix-input">
                <input
                  min="0"
                  max="360"
                  type="number"
                  value={state.maxCommuteMinutes}
                  onChange={(event) =>
                    setState({ ...state, maxCommuteMinutes: event.target.value })
                  }
                />
                <span>minutes</span>
              </span>
            </label>
            <label>
              Pets traveling
              <input
                value={state.pets.join(", ")}
                onChange={(event) =>
                  setState({
                    ...state,
                    pets: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Dog, cat"
              />
            </label>
            <label>
              Accessibility needs
              <input
                value={state.accessibilityNeeds.join(", ")}
                onChange={(event) =>
                  setState({
                    ...state,
                    accessibilityNeeds: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Step-free entry, accessible bathroom"
              />
            </label>
          </div>
          <fieldset>
            <legend>What should be close to home?</legend>
            <div className="chip-picker">
              {dailyNeedOptions.map((item) => (
                <label className="check-chip" key={item}>
                  <input
                    checked={state.dailyNeeds.includes(item)}
                    onChange={() =>
                      setState({ ...state, dailyNeeds: toggle(state.dailyNeeds, item) })
                    }
                    type="checkbox"
                  />
                  {item}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      ),
    },
    {
      eyebrow: "06 · Your ranking lens",
      title: "Tell Area Intelligence what matters most to you.",
      content: (
        <>
          <div className="chip-picker">
            {priorityOptions.map((item) => (
              <label className="check-chip" key={item}>
                <input
                  checked={state.priorityTags.includes(item)}
                  onChange={() =>
                    setState({
                      ...state,
                      priorityTags: toggle(state.priorityTags, item),
                    })
                  }
                  type="checkbox"
                />
                {item}
              </label>
            ))}
          </div>
          <div className="weight-list">
            {[
              ["housing", "Housing fit"],
              ["reportedCrime", "Reported crime context"],
              ["mobility", "Mobility and commute"],
              ["market", "Housing market context"],
              ["dailyLife", "Daily-life fit"],
            ].map(([key, label]) => (
              <label className="range-row" key={key}>
                <span>{label}</span>
                <input
                  min="0"
                  max="100"
                  type="range"
                  value={state.weights[key as keyof SetupState["weights"]]}
                  onChange={(event) =>
                    setState({
                      ...state,
                      weights: {
                        ...state.weights,
                        [key]: Number(event.target.value),
                      },
                    })
                  }
                />
                <output>{state.weights[key as keyof SetupState["weights"]]}</output>
              </label>
            ))}
          </div>
          <p className="data-note">
            Scores use only measures that actually load. Missing categories are excluded
            from the weighted denominator and never treated as zero.
          </p>
        </>
      ),
    },
    {
      eyebrow: "07 · Your atlas",
      title: "We’ll shape the workspace around this move.",
      content: (
        <div className="setup-summary">
          <div>
            <span>Route</span>
            <strong>{summary}</strong>
          </div>
          <div>
            <span>Home path</span>
            <strong>
              {state.housingIntent} · {state.propertyTypes.join(", ") || "Still deciding"}
            </strong>
          </div>
          <div>
            <span>Daily-life lens</span>
            <strong>{state.priorityTags.join(", ") || "Balanced"}</strong>
          </div>
          <p>
            Move Atlas will create a private move plan, setup-derived roadmap, and
            tailored pages. You can change every preference later.
          </p>
        </div>
      ),
    },
  ];

  async function finish() {
    setError("");
    setSaving(true);
    const response = await fetch("/api/move-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: state.name,
        personName: state.personName,
        household: state.household,
        originLabel: state.originLabel,
        destinationLabel: state.destinationLabel,
        moveType: state.moveType,
        targetDate: state.targetDate || null,
        timeframe: state.timeframe,
        housingIntent: state.housingIntent,
        housingMaxCents: dollarsToCents(state.housingMax),
        savingsCents: dollarsToCents(state.savings),
        moveFundTargetCents: dollarsToCents(state.moveFundTarget),
        propertyTypes: state.propertyTypes.map((value) =>
          value.toLowerCase().replace(/\s+/g, "-"),
        ),
        bedrooms: state.bedrooms ? Number(state.bedrooms) : null,
        bathrooms: state.bathrooms ? Number(state.bathrooms) : null,
        pets: state.pets,
        accessibilityNeeds: state.accessibilityNeeds,
        commuteMode: state.commuteMode,
        maxCommuteMinutes: Number(state.maxCommuteMinutes),
        dailyNeeds: state.dailyNeeds,
        priorityTags: state.priorityTags,
        weights: state.weights,
      }),
    });
    const result = (await response.json()) as { id?: string; error?: string };
    setSaving(false);

    if (!response.ok || !result.id) {
      setError(result.error ?? "Your move plan could not be created.");
      return;
    }

    router.replace(`/app/${result.id}/overview`);
    router.refresh();
  }

  return (
    <main className="setup-shell" id="main-content">
      <div className="setup-header">
        <Link className="brand-lockup inverse" href="/">
          <span className="brand-mark">M</span>
          <span>Move Atlas</span>
        </Link>
        <span>
          Step {step + 1} of {steps.length}
        </span>
      </div>
      <div className="setup-progress" aria-label="Setup progress">
        <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
      </div>
      <section className="setup-card">
        <span className="eyebrow">{steps[step].eyebrow}</span>
        <h1 ref={heading} tabIndex={-1}>
          {steps[step].title}
        </h1>
        <div className="setup-content">{steps[step].content}</div>
        {error ? (
          <p className="form-message error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="setup-actions">
          <button
            className="button ghost"
            disabled={step === 0 || saving}
            onClick={() => {
              setError("");
              setStep((value) => value - 1);
            }}
            type="button"
          >
            Back
          </button>
          {step < steps.length - 1 ? (
            <button
              className="button primary"
              onClick={continueSetup}
              type="button"
            >
              Continue
            </button>
          ) : (
            <button
              className="button primary"
              disabled={saving}
              onClick={finish}
              type="button"
            >
              {saving ? "Creating your atlas…" : "Open my move"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
