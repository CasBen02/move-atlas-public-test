import type { ProviderResult } from "./result";
import { available, unavailable } from "./result";

export interface RuntimeParser<T> {
  parse(value: unknown): T;
}

export interface SafeFetchJsonOptions<T> {
  provider: string;
  source: string;
  url: string | URL;
  init?: RequestInit;
  parser: RuntimeParser<T>;
  timeoutMs?: number;
  maximumAttempts?: number;
  retryBaseDelayMs?: number;
  coverage: string;
  caveats?: string[];
  now?: () => Date;
  fetchImplementation?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusReason(status: number) {
  if (status === 401 || status === 403) return "authentication_failed" as const;
  if (status === 404) return "not_found" as const;
  if (status === 429) return "rate_limited" as const;
  return "provider_error" as const;
}

/**
 * Fetches JSON without returning request URLs, headers, response bodies, or
 * credentials in errors. Only sanitized provider state leaves this function.
 */
export async function safeFetchJson<T>(
  options: SafeFetchJsonOptions<T>,
): Promise<ProviderResult<T>> {
  const fetcher = options.fetchImplementation ?? fetch;
  const attempts = Math.max(1, Math.min(options.maximumAttempts ?? 3, 5));
  const timeoutMs = Math.max(100, options.timeoutMs ?? 8_000);
  const retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? 200);
  const now = options.now ?? (() => new Date());
  let lastReason: "timeout" | "network_error" = "network_error";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = options.init?.signal;
    const abortFromExternal = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    const headers = new Headers(options.init?.headers);
    if (!headers.has("accept")) headers.set("accept", "application/json");

    try {
      const response = await fetcher(options.url, {
        ...options.init,
        signal: controller.signal,
        headers,
      });

      if (!response.ok) {
        const providerError = await response.clone().json().catch(() => null);
const providerErrorRecord =
  providerError && typeof providerError === "object"
    ? (providerError as Record<string, unknown>)
    : null;

console.error("Provider request failed", {
  provider: options.provider,
  status: response.status,
  code:
    typeof providerErrorRecord?.code === "string"
      ? providerErrorRecord.code
      : null,
  title:
    typeof providerErrorRecord?.title === "string"
      ? providerErrorRecord.title
      : null,
  cause:
    typeof providerErrorRecord?.cause === "string"
      ? providerErrorRecord.cause
      : null,
});
        const retryable = RETRYABLE_STATUS.has(response.status);
        if (retryable && attempt < attempts) {
          const requestedDelay = retryAfterMs(response);
          await delay(Math.min(requestedDelay ?? retryBaseDelayMs * 2 ** (attempt - 1), 2_000));
          continue;
        }
        return unavailable({
          reason: statusReason(response.status),
          message:
            response.status === 429
              ? `${options.provider} is temporarily rate limiting requests.`
              : `${options.provider} did not return the requested information.`,
          retryable,
          meta: {
            provider: options.provider,
            source: options.source,
            checkedAt: now().toISOString(),
            coverage: options.coverage,
            caveats: options.caveats ?? [],
          },
        });
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        return unavailable({
          reason: "invalid_response",
          message: `${options.provider} returned a response that could not be read.`,
          retryable: false,
          meta: {
            provider: options.provider,
            source: options.source,
            checkedAt: now().toISOString(),
            coverage: options.coverage,
            caveats: options.caveats ?? [],
          },
        });
      }

      try {
        const data = options.parser.parse(raw);
        const retrievedAt = now().toISOString();
        return available(data, {
          provider: options.provider,
          source: options.source,
          retrievedAt,
          freshness: "recently_updated",
          coverage: options.coverage,
          caveats: options.caveats ?? [],
        });
      } catch {
        return unavailable({
          reason: "invalid_response",
          message: `${options.provider} returned data in an unexpected format.`,
          retryable: false,
          meta: {
            provider: options.provider,
            source: options.source,
            checkedAt: now().toISOString(),
            coverage: options.coverage,
            caveats: options.caveats ?? [],
          },
        });
      }
    } catch (error) {
      lastReason =
        controller.signal.aborted || (error instanceof Error && error.name === "AbortError")
          ? "timeout"
          : "network_error";
      if (attempt < attempts) {
        await delay(retryBaseDelayMs * 2 ** (attempt - 1));
        continue;
      }
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }

  return unavailable({
    reason: lastReason,
    message:
      lastReason === "timeout"
        ? `${options.provider} did not respond before the request timed out.`
        : `${options.provider} could not be reached.`,
    retryable: true,
    meta: {
      provider: options.provider,
      source: options.source,
      checkedAt: now().toISOString(),
      coverage: options.coverage,
      caveats: options.caveats ?? [],
    },
  });
}
