import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));
const optionalNonEmpty = z.string().min(1).optional().or(z.literal(""));

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalNonEmpty,
  NEXT_PUBLIC_HERE_MAPS_API_KEY: optionalNonEmpty,
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: optionalNonEmpty,
  HERE_SERVER_API_KEY: optionalNonEmpty,
  NWS_USER_AGENT: optionalNonEmpty,
  CENSUS_API_KEY: optionalNonEmpty,
  BLS_API_KEY: optionalNonEmpty,
  OPENAI_API_KEY: optionalNonEmpty,
  SENTRY_DSN: optionalUrl,
  CRON_SECRET: optionalNonEmpty,
});

export type ServerEnvironment = z.infer<typeof serverSchema>;

let cachedServerEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  if (cachedServerEnvironment) return cachedServerEnvironment;
  cachedServerEnvironment = serverSchema.parse(process.env);
  return cachedServerEnvironment;
}

export function getPublicEnvironment() {
  const value = publicSchema.parse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_HERE_MAPS_API_KEY:
      process.env.NEXT_PUBLIC_HERE_MAPS_API_KEY,
  });

  return {
    ...value,
    supabaseConfigured: Boolean(
      value.NEXT_PUBLIC_SUPABASE_URL &&
        value.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
    hereMapConfigured: Boolean(value.NEXT_PUBLIC_HERE_MAPS_API_KEY),
  };
}

export function validateProductionEnvironment(
  env: NodeJS.ProcessEnv = process.env,
) {
  const parsedEnvironment = serverSchema.safeParse(env);
  if (!parsedEnvironment.success) {
    return {
      valid: false,
      missing: [
        ...new Set(
          parsedEnvironment.error.issues.map(
            (issue) => issue.path.join(".") || "environment",
          ),
        ),
      ],
      optional: {
        openAiCredentialPresent: false,
        monitoringCredentialPresent: false,
        blsCredentialPresent: false,
      },
    };
  }

  const checked = parsedEnvironment.data;
  const missing: string[] = [];
  const placeholderPattern =
    /replace[_-]?me|change[_-]?me|your-project|\.example(?:[/:)]|$)|example\.com/i;

  function productionValue(
    key: keyof ServerEnvironment,
    options: { minimumLength?: number } = {},
  ) {
    const value = checked[key];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      placeholderPattern.test(value) ||
      value.trim().length < (options.minimumLength ?? 1)
    ) {
      missing.push(key);
      return null;
    }
    return value.trim();
  }

  const appUrl = productionValue("NEXT_PUBLIC_APP_URL");
  if (appUrl) {
    const parsed = new URL(appUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      missing.push("NEXT_PUBLIC_APP_URL (public HTTPS origin)");
    }
  }

  const supabaseUrl = productionValue("NEXT_PUBLIC_SUPABASE_URL");
  if (supabaseUrl && new URL(supabaseUrl).protocol !== "https:") {
    missing.push("NEXT_PUBLIC_SUPABASE_URL (HTTPS)");
  }

  productionValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", {
    minimumLength: 20,
  });
  productionValue("SUPABASE_SERVICE_ROLE_KEY", { minimumLength: 20 });
  productionValue("NEXT_PUBLIC_HERE_MAPS_API_KEY", { minimumLength: 16 });
  productionValue("HERE_SERVER_API_KEY", { minimumLength: 16 });
  const nwsUserAgent = productionValue("NWS_USER_AGENT", {
    minimumLength: 10,
  });
  if (
    nwsUserAgent &&
    !/(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|https?:\/\/\S+)/.test(nwsUserAgent)
  ) {
    missing.push("NWS_USER_AGENT (application identifier and contact)");
  }
  productionValue("CENSUS_API_KEY", { minimumLength: 10 });
  productionValue("CRON_SECRET", { minimumLength: 24 });

  return {
    valid: new Set(missing).size === 0,
    missing: [...new Set(missing)],
    optional: {
      openAiCredentialPresent: Boolean(checked.OPENAI_API_KEY),
      monitoringCredentialPresent: Boolean(checked.SENTRY_DSN),
      blsCredentialPresent: Boolean(checked.BLS_API_KEY),
    },
  };
}

export function resetEnvironmentCacheForTests() {
  cachedServerEnvironment = undefined;
}
