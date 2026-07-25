import type { HereRouteAlternative } from "../providers";

export type RouteStrategy =
  | "fastest"
  | "shortest"
  | "fuel_conscious"
  | "truck_suitable"
  | "weather_aware"
  | "custom";

export type RouteStrategyDisclosure = {
  title: string;
  explanation: string;
  enforcement: "provider" | "provider_and_local_score" | "preference_only";
};

/**
 * HERE enforces the requested routing mode and avoidance options. The only
 * local ranking currently applied is a transparent distance proxy for the
 * fuel-conscious option; weather never silently changes the route order.
 */
export function rankRouteAlternatives(
  routes: readonly HereRouteAlternative[],
  strategy: RouteStrategy,
): HereRouteAlternative[] {
  if (strategy !== "fuel_conscious") return [...routes];
  return [...routes].sort(
    (left, right) =>
      left.lengthMeters - right.lengthMeters ||
      left.durationSeconds - right.durationSeconds,
  );
}

export function routeStrategyDisclosure(
  strategy: RouteStrategy,
  transportMode: "car" | "truck",
): RouteStrategyDisclosure {
  switch (strategy) {
    case "fastest":
      return {
        title: "Fastest available route",
        explanation:
          "HERE fast routing selected and ordered the alternatives using the entered departure time, vehicle profile, and supported avoidances.",
        enforcement: "provider",
      };
    case "shortest":
      return {
        title: "Shortest practical route",
        explanation:
          "HERE short routing generated the alternatives using the entered vehicle profile and supported avoidances.",
        enforcement: "provider",
      };
    case "fuel_conscious":
      return {
        title: "Fuel-conscious distance ranking",
        explanation:
          "HERE generated valid fast-route alternatives, then Move Atlas ranked the returned options by route distance as a transparent fuel-use proxy. Fuel price does not alter the provider route.",
        enforcement: "provider_and_local_score",
      };
    case "truck_suitable":
      return transportMode === "truck"
        ? {
            title: "Truck-profile route",
            explanation:
              "HERE truck routing received the entered dimensions, weight, trailer profile, clearance buffer, and supported avoidances. Coverage is not complete for every road segment.",
            enforcement: "provider",
          }
        : {
            title: "Truck suitability preference",
            explanation:
              "The selected vehicle uses HERE car routing, so truck suitability is shown as a preference only and is not provider-enforced.",
            enforcement: "preference_only",
          };
    case "weather_aware":
      return {
        title: "Weather comparison preference",
        explanation:
          "HERE generated the route using supported routing inputs. NWS weather is evaluated afterward for the saved alternative and does not alter the provider route.",
        enforcement: "preference_only",
      };
    case "custom":
      return {
        title: "Custom supported avoidances",
        explanation:
          "HERE enforces the supported avoidance selections. Any preference not represented by a provider request remains decision support only.",
        enforcement: "provider",
      };
  }
}
