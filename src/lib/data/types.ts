export type DataStatus = "fresh" | "stale" | "unavailable" | "sample";

export type UserProfile = {
  id: string;
  display_name: string | null;
  active_move_plan_id: string | null;
  onboarding_completed_at: string | null;
  legacy_import_completed_at: string | null;
};

export type MovePlan = {
  id: string;
  user_id: string;
  name: string;
  status: string;
  person_name: string | null;
  household: string | null;
  origin_label: string | null;
  destination_label: string | null;
  move_type: string | null;
  target_date: string | null;
  timeframe: string | null;
  housing_intent: string | null;
  housing_max_cents: number | null;
  savings_cents: number | null;
  move_fund_target_cents: number | null;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SetupPreferences = {
  property_types: string[];
  bedrooms: number | null;
  bathrooms: number | null;
  pets: string[];
  accessibility_needs: string[];
  commute_mode: string | null;
  max_commute_minutes: number | null;
  daily_needs: string[];
  priority_tags: string[];
  housing_weight: number;
  reported_crime_weight: number;
  mobility_weight: number;
  market_weight: number;
  daily_life_weight: number;
};

export type WorkspaceRecord = {
  id: string;
  move_plan_id: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type WorkspaceData = {
  profile: UserProfile;
  plans: MovePlan[];
  plan: MovePlan;
  preferences: SetupPreferences | null;
  records: Record<string, WorkspaceRecord[]>;
};
