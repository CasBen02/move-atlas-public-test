import { describe, expect, it } from "vitest";

import { validateProductionEnvironment } from "../../src/lib/env";

const validEnvironment = {
  NODE_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://move-atlas.invalid",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijk.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    "sb_publishable_validation_only_123456",
  SUPABASE_SERVICE_ROLE_KEY: "validation_only_service_role_123456",
  NEXT_PUBLIC_HERE_MAPS_API_KEY: "validation_only_browser_key_123",
  HERE_SERVER_API_KEY: "validation_only_server_key_123",
  NWS_USER_AGENT: "MoveAtlas/1.0 (support@move-atlas.invalid)",
  CENSUS_API_KEY: "validation_only_census_key_123",
  CRON_SECRET: "validation_only_cron_secret_123456789",
} satisfies NodeJS.ProcessEnv;

describe("production environment validation", () => {
  it("accepts complete, non-placeholder production configuration", () => {
    expect(validateProductionEnvironment(validEnvironment)).toMatchObject({
      valid: true,
      missing: [],
    });
  });

  it("rejects an insecure public application origin", () => {
    const result = validateProductionEnvironment({
      ...validEnvironment,
      NEXT_PUBLIC_APP_URL: "http://move-atlas.invalid",
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toContain(
      "NEXT_PUBLIC_APP_URL (public HTTPS origin)",
    );
  });

  it("rejects committed example placeholders", () => {
    const result = validateProductionEnvironment({
      ...validEnvironment,
      NEXT_PUBLIC_SUPABASE_URL: "https://your-project.supabase.co",
      HERE_SERVER_API_KEY: "replace_me_server_only",
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining([
        "NEXT_PUBLIC_SUPABASE_URL",
        "HERE_SERVER_API_KEY",
      ]),
    );
  });

  it("requires an operator contact in the NWS user agent", () => {
    const result = validateProductionEnvironment({
      ...validEnvironment,
      NWS_USER_AGENT: "MoveAtlas-production",
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toContain(
      "NWS_USER_AGENT (application identifier and contact)",
    );
  });

  it("does not describe a reserved credential as an active adapter", () => {
    const result = validateProductionEnvironment({
      ...validEnvironment,
      OPENAI_API_KEY: "credential_presence_only",
    });

    expect(result.optional.openAiCredentialPresent).toBe(true);
    expect(result.valid).toBe(true);
  });
});
