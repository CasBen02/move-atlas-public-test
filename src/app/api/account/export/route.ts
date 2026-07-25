import type { NextRequest } from "next/server";
import {
  accountExportColumns,
  sanitizeAccountExportRows,
  type AccountExportTable,
} from "@/lib/data/account-export";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";

export async function GET(request: NextRequest) {
  const auth = await authorizeApiRequest(request, { limit: 3 });
  if (!auth.ok) return auth.response;

  const entries = await Promise.all(
    Object.entries(accountExportColumns).map(async ([table, columns]) => {
      const { data, error } = await auth.supabase
        .from(table)
        .select(columns.join(","))
        .eq("user_id", auth.user.id);
      return {
        table: table as AccountExportTable,
        data,
        error,
      };
    }),
  );

  if (entries.some(({ error }) => error)) {
    return noStoreJson(
      { error: "Your account export could not be prepared completely. Try again." },
      { status: 503 },
    );
  }

  const body = JSON.stringify(
    {
      schema: "move-atlas-export-v1",
      generatedAt: new Date().toISOString(),
      accountId: auth.user.id,
      data: Object.fromEntries(
        entries.map(({ table, data }) => [
          table,
          sanitizeAccountExportRows(table, data),
        ]),
      ),
      notice:
        "This export excludes passwords, sessions, provider credentials, raw provider payloads, security logs, and document contents.",
    },
    null,
    2,
  );

  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `attachment; filename="move-atlas-export-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
