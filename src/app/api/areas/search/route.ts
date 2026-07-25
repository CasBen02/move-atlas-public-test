import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";
import { HereGeocodingProvider } from "@/lib/providers";

export async function GET(request: NextRequest) {
  const auth = await authorizeApiRequest(request, { limit: 30 });
  if (!auth.ok) return auth.response;
  const query = z.string().trim().min(2).max(200).safeParse(
    request.nextUrl.searchParams.get("q"),
  );
  if (!query.success) {
    return noStoreJson({ error: "Enter at least two characters." }, { status: 400 });
  }
  const provider = new HereGeocodingProvider({
    apiKey: process.env.HERE_SERVER_API_KEY,
  });
  const result = await provider.search({
    kind: "geocode",
    query: query.data,
    limit: 8,
  });
  return noStoreJson(result, {
    status: result.status === "available" ? 200 : result.retryable ? 503 : 422,
  });
}
