const FLEXIBLE_POLYLINE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const DECODING_TABLE = new Map(
  [...FLEXIBLE_POLYLINE_ALPHABET].map((character, index) => [character, index]),
);

export interface DecodedFlexiblePolyline {
  precision: number;
  thirdDimension:
    | "absent"
    | "level"
    | "altitude"
    | "elevation"
    | "reserved_4"
    | "reserved_5"
    | "custom_1"
    | "custom_2";
  thirdDimensionPrecision: number;
  points: { lat: number; lng: number; thirdDimensionValue?: number }[];
}

function decodeUnsigned(
  encoded: string,
  cursor: { index: number },
): number {
  let result = 0;
  let shift = 0;
  while (cursor.index < encoded.length) {
    const value = DECODING_TABLE.get(encoded[cursor.index]);
    cursor.index += 1;
    if (value === undefined) throw new Error("Flexible polyline contains an invalid character.");
    result += (value & 0x1f) * 2 ** shift;
    if ((value & 0x20) === 0) return result;
    shift += 5;
    if (shift > 52) throw new Error("Flexible polyline value exceeds safe numeric precision.");
  }
  throw new Error("Flexible polyline ended in an incomplete value.");
}

function decodeSigned(value: number): number {
  const magnitude = Math.floor(value / 2);
  return value % 2 === 1 ? -magnitude - 1 : magnitude;
}

const THIRD_DIMENSIONS: DecodedFlexiblePolyline["thirdDimension"][] = [
  "absent",
  "level",
  "altitude",
  "elevation",
  "reserved_4",
  "reserved_5",
  "custom_1",
  "custom_2",
];

/**
 * Decodes HERE's published Flexible Polyline format without sending route
 * geometry to another service.
 */
export function decodeHereFlexiblePolyline(
  encoded: string,
  options: { maximumPoints?: number } = {},
): DecodedFlexiblePolyline {
  if (!encoded) throw new RangeError("Flexible polyline is required.");
  if (encoded.length > 5_000_000) {
    throw new RangeError("Flexible polyline exceeds the maximum encoded length.");
  }
  const maximumPoints = options.maximumPoints ?? 100_000;
  if (!Number.isInteger(maximumPoints) || maximumPoints < 1 || maximumPoints > 1_000_000) {
    throw new RangeError("Maximum flexible-polyline point count is invalid.");
  }
  const cursor = { index: 0 };
  const version = decodeUnsigned(encoded, cursor);
  if (version !== 1) throw new Error(`Unsupported flexible polyline version: ${version}.`);
  const header = decodeUnsigned(encoded, cursor);
  const precision = header & 0x0f;
  const thirdDimensionIndex = (header >> 4) & 0x07;
  const thirdDimensionPrecision = (header >> 7) & 0x0f;
  const thirdDimension = THIRD_DIMENSIONS[thirdDimensionIndex];
  const coordinateFactor = 10 ** precision;
  const thirdFactor = 10 ** thirdDimensionPrecision;
  let latitude = 0;
  let longitude = 0;
  let third = 0;
  const points: DecodedFlexiblePolyline["points"] = [];

  while (cursor.index < encoded.length) {
    if (points.length >= maximumPoints) {
      throw new RangeError("Flexible polyline exceeds the configured point limit.");
    }
    latitude += decodeSigned(decodeUnsigned(encoded, cursor));
    longitude += decodeSigned(decodeUnsigned(encoded, cursor));
    if (thirdDimension !== "absent") {
      third += decodeSigned(decodeUnsigned(encoded, cursor));
    }
    points.push({
      lat: latitude / coordinateFactor,
      lng: longitude / coordinateFactor,
      ...(thirdDimension === "absent"
        ? {}
        : { thirdDimensionValue: third / thirdFactor }),
    });
  }

  if (points.length === 0) throw new Error("Flexible polyline contains no coordinates.");
  return {
    precision,
    thirdDimension,
    thirdDimensionPrecision,
    points,
  };
}
