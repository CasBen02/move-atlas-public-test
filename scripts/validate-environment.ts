import { validateProductionEnvironment } from "../src/lib/env";

const result = validateProductionEnvironment();

if (!result.valid) {
  console.error("Move Atlas production environment is incomplete:");
  result.missing.forEach((name) => console.error(`- ${name}`));
  process.exitCode = 1;
} else {
  console.log("Move Atlas production environment is valid.");
}

console.log(
  [
    "Optional credentials present",
    `OpenAI: ${result.optional.openAiCredentialPresent ? "yes" : "no"}`,
    `monitoring: ${result.optional.monitoringCredentialPresent ? "yes" : "no"}`,
    `BLS: ${result.optional.blsCredentialPresent ? "yes" : "no"}`,
    "(presence does not mean an adapter is active)",
  ].join(" — "),
);
