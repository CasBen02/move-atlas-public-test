import { z } from "zod";

import type { ProviderResult } from "./result";
import { available, unavailable } from "./result";
import { safeFetchJson } from "./safe-fetch";

export const EDUCATION_DATA_SOURCE =
  "https://educationdata.urban.org/documentation/schools.html";

const DIRECTORY_YEAR = 2024;
const STATE_FIPS: Record<string, number> = {
  AL: 1,
  AK: 2,
  AZ: 4,
  AR: 5,
  CA: 6,
  CO: 8,
  CT: 9,
  DE: 10,
  DC: 11,
  FL: 12,
  GA: 13,
  HI: 15,
  ID: 16,
  IL: 17,
  IN: 18,
  IA: 19,
  KS: 20,
  KY: 21,
  LA: 22,
  ME: 23,
  MD: 24,
  MA: 25,
  MI: 26,
  MN: 27,
  MS: 28,
  MO: 29,
  MT: 30,
  NE: 31,
  NV: 32,
  NH: 33,
  NJ: 34,
  NM: 35,
  NY: 36,
  NC: 37,
  ND: 38,
  OH: 39,
  OK: 40,
  OR: 41,
  PA: 42,
  RI: 44,
  SC: 45,
  SD: 46,
  TN: 47,
  TX: 48,
  UT: 49,
  VT: 50,
  VA: 51,
  WA: 53,
  WV: 54,
  WI: 55,
  WY: 56,
};

function optionalFlag(value: number | null | undefined) {
  if (value === 1) return true;
  if (value === 0) return false;
  return null;
}

const schoolDirectoryRecordSchema = z
  .object({
    ncessch: z.union([z.string(), z.number()]).transform(String),
    school_name: z.string(),
    lea_name: z.string().nullable().optional(),
    street_location: z.string().nullable().optional(),
    city_location: z.string().nullable().optional(),
    state_location: z.string().nullable().optional(),
    zip_location: z.union([z.string(), z.number()]).nullable().optional(),
    latitude: z.coerce.number().nullable().optional(),
    longitude: z.coerce.number().nullable().optional(),
    school_level: z.coerce.number().nullable().optional(),
    school_type: z.coerce.number().nullable().optional(),
    charter: z.coerce.number().nullable().optional(),
    magnet: z.coerce.number().nullable().optional(),
    virtual: z.coerce.number().nullable().optional(),
  })
  .passthrough();

const schoolDirectoryResponseSchema = z
  .object({
    results: z.array(schoolDirectoryRecordSchema),
    next: z.string().nullable().optional(),
    count: z.coerce.number().optional(),
  })
  .passthrough();
export interface PublicSchoolDirectoryRecord {
  ncesSchoolId: string;
  schoolName: string;
  districtName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  schoolLevel: number | null;
  schoolType: number | null;
  isCharter: boolean | null;
  isMagnet: boolean | null;
  isVirtual: boolean | null;
}

export interface PublicSchoolDirectoryProfile {
  year: number;
  locationLabel: string;
  schools: PublicSchoolDirectoryRecord[];
  totalMatched: number;
  caveats: string[];
}
export class EducationSchoolDirectoryProvider {
  async cityProfile(
    cityName: string,
    stateAbbreviation: string,
  ): Promise<ProviderResult<PublicSchoolDirectoryProfile>> {
    const city = cityName.trim();
    const state = stateAbbreviation.trim().toUpperCase();
    const fips = STATE_FIPS[state];

    if (!city || !fips) {
      return unavailable({
        reason: "unsupported_location",
        message: "A valid city and two-letter state abbreviation are required.",
        retryable: false,
        meta: {
          provider: "Education Data Portal",
          source: EDUCATION_DATA_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "Public-school directory context by city and state.",
          caveats: [
            "Directory information is not a school-performance ranking.",
          ],
        },
      });
    }

    const endpoint = new URL(
      `https://educationdata.urban.org/api/v1/schools/ccd/directory/${DIRECTORY_YEAR}/`,
    );

    endpoint.searchParams.set("fips", String(fips));

    const records: z.infer<typeof schoolDirectoryRecordSchema>[] = [];
    let nextUrl: string | null = endpoint.toString();
    let totalMatched = 0;
    let retrievedAt = new Date().toISOString();

    for (let page = 0; nextUrl && page < 5; page += 1) {
      const result = await safeFetchJson({
        provider: "Education Data Portal",
        source: EDUCATION_DATA_SOURCE,
        url: nextUrl,
        parser: schoolDirectoryResponseSchema,
        coverage: `2024 CCD public-school directory records for ${state}.`,
        caveats: [
          "Directory information describes schools and does not measure school quality.",
          "Attendance boundaries and assigned schools must be confirmed with the local district.",
        ],
        timeoutMs: 10_000,
        maximumAttempts: 3,
      });

      if (result.status === "unavailable") return result;

      records.push(...result.data.results);
      totalMatched = result.data.count ?? records.length;
      retrievedAt = result.meta.retrievedAt;

      if (!result.data.next) {
        nextUrl = null;
        continue;
      }

      const candidate = new URL(result.data.next, endpoint);

      if (candidate.origin !== endpoint.origin) {
        return unavailable({
          reason: "invalid_response",
          message: "The school directory returned an invalid pagination link.",
          retryable: false,
          meta: {
            provider: "Education Data Portal",
            source: EDUCATION_DATA_SOURCE,
            checkedAt: new Date().toISOString(),
            coverage: "Public-school directory context by city and state.",
            caveats: [],
          },
        });
      }

      nextUrl = candidate.toString();
    }
    const normalizedCity = city.toLocaleLowerCase("en-US");

    const schools = records
      .filter(
        (record) =>
          record.city_location?.trim().toLocaleLowerCase("en-US") ===
          normalizedCity,
      )
      .map(
        (record): PublicSchoolDirectoryRecord => ({
          ncesSchoolId: record.ncessch,
          schoolName: record.school_name,
          districtName: record.lea_name?.trim() || null,
          address: record.street_location?.trim() || null,
          city: record.city_location?.trim() || null,
          state: record.state_location?.trim() || state,
          postalCode:
            record.zip_location === null ||
            record.zip_location === undefined
              ? null
              : String(record.zip_location).padStart(5, "0"),
          latitude: record.latitude ?? null,
          longitude: record.longitude ?? null,
          schoolLevel: record.school_level ?? null,
          schoolType: record.school_type ?? null,
          isCharter: optionalFlag(record.charter),
          isMagnet: optionalFlag(record.magnet),
          isVirtual: optionalFlag(record.virtual),
        }),
      )
      .sort((left, right) =>
        left.schoolName.localeCompare(right.schoolName),
      );

    if (!schools.length) {
      return unavailable({
        reason: "not_found",
        message: `No public-school directory records were found for ${city}, ${state}.`,
        retryable: false,
        meta: {
          provider: "Education Data Portal",
          source: EDUCATION_DATA_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: `2024 CCD public-school directory records for ${city}, ${state}.`,
          caveats: [
            "Directory information is not a school-performance ranking.",
          ],
        },
      });
    }

    const caveats = [
      "Directory information describes schools and does not measure school quality.",
      "Attendance boundaries and assigned schools must be confirmed with the local district.",
      `${records.length.toLocaleString("en-US")} of ${totalMatched.toLocaleString(
        "en-US",
      )} statewide directory records were checked before city filtering.`,
    ];

    return available(
      {
        year: DIRECTORY_YEAR,
        locationLabel: `${city}, ${state}`,
        schools,
        totalMatched: schools.length,
        caveats,
      },
      {
        provider: "Education Data Portal",
        source: EDUCATION_DATA_SOURCE,
        retrievedAt,
        coverage: `2024 CCD public-school directory records for ${city}, ${state}.`,
        caveats,
      },
    );
  }
}
