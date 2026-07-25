export type ProviderFreshness =
  | "live"
  | "recently_updated"
  | "cached"
  | "stale"
  | "estimated";

export type ProviderUnavailableReason =
  | "not_configured"
  | "unsupported_location"
  | "not_found"
  | "authentication_failed"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "provider_error"
  | "invalid_response"
  | "insufficient_coverage";

export interface ProviderMetadata {
  provider: string;
  source: string;
  retrievedAt: string;
  observedAt?: string;
  validFrom?: string;
  validUntil?: string;
  expiresAt?: string;
  freshness: ProviderFreshness;
  coverage: string;
  caveats: string[];
}
export interface ProviderAvailable<T> {
  status: "available";
  data: T;
  meta: ProviderMetadata;
}

export interface ProviderUnavailable {
  status: "unavailable";
  reason: ProviderUnavailableReason;
  message: string;
  retryable: boolean;
  meta: {
    provider: string;
    source: string;
    checkedAt: string;
    coverage?: string;
    caveats: string[];
  };
}

export type ProviderResult<T> = ProviderAvailable<T> | ProviderUnavailable;

export interface CachedProviderEntry<T> {
  data: T;
  meta: Omit<ProviderMetadata, "freshness">;
}

export function available<T>(
  data: T,
  meta: Omit<ProviderMetadata, "freshness"> & { freshness?: ProviderFreshness },
): ProviderAvailable<T> {
  return {
    status: "available",
    data,
    meta: {
      ...meta,
      freshness: meta.freshness ?? "recently_updated",
    },
  };
}

export function unavailable(
  input: Omit<ProviderUnavailable, "status">,
): ProviderUnavailable {
  return { status: "unavailable", ...input };
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyCachedFreshness(
  entry: CachedProviderEntry<unknown>,
  now = new Date(),
): Extract<ProviderFreshness, "cached" | "stale"> {
  const expiry = entry.meta.expiresAt ? timestamp(entry.meta.expiresAt) : null;
  if (expiry !== null) return now.getTime() <= expiry ? "cached" : "stale";
  const validUntil = entry.meta.validUntil ? timestamp(entry.meta.validUntil) : null;
  return validUntil !== null && now.getTime() <= validUntil ? "cached" : "stale";
}

export function cachedResult<T>(
  entry: CachedProviderEntry<T>,
  now = new Date(),
): ProviderAvailable<T> {
  const freshness = classifyCachedFreshness(entry, now);
  return available(entry.data, {
    ...entry.meta,
    freshness,
    caveats:
      freshness === "stale"
        ? [
            ...entry.meta.caveats,
            "This is the most recent cached provider response and may no longer reflect current conditions.",
          ]
        : entry.meta.caveats,
  });
}

export function staleCacheFallback<T>(input: {
  cache: CachedProviderEntry<T> | null;
  failure: ProviderUnavailable;
  now?: Date;
  maximumStaleAgeMs: number;
}): ProviderResult<T> {
  if (!input.cache) return input.failure;
  const retrieved = timestamp(input.cache.meta.retrievedAt);
  const now = input.now ?? new Date();
  if (
    retrieved === null ||
    now.getTime() - retrieved > input.maximumStaleAgeMs ||
    now.getTime() < retrieved
  ) {
    return input.failure;
  }

  return available(input.cache.data, {
    ...input.cache.meta,
    freshness: "stale",
    caveats: [
      ...input.cache.meta.caveats,
      `The provider refresh failed (${input.failure.reason}); showing a clearly marked stale response.`,
    ],
  });
}
