import { expect, test, type Page } from "@playwright/test";

const runLive = process.env.E2E_RUN_LIVE === "true";
const emailDomain = (process.env.E2E_EMAIL_DOMAIN ?? "").replace(/^@/, "");
const password = process.env.E2E_TEST_PASSWORD ?? "";
const autoConfirmEnabled =
  process.env.E2E_SUPABASE_AUTO_CONFIRM === "true";
const validEmailDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(emailDomain);

const liveRequirements = [
  !runLive && "E2E_RUN_LIVE=true",
  !validEmailDomain && "E2E_EMAIL_DOMAIN",
  password.length < 10 && "E2E_TEST_PASSWORD (at least 10 characters)",
  !autoConfirmEnabled && "E2E_SUPABASE_AUTO_CONFIRM=true",
].filter(Boolean) as string[];

async function openSection(page: Page, name: string, path: string) {
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${path}$`));
}

async function expectWorkspace(page: Page, section = "overview") {
  await expect(page).toHaveURL(
    new RegExp(`/app/[0-9a-f-]+/${section}$`, "i"),
  );
  await expect(page.getByText("Cloud saved", { exact: true })).toBeVisible();
}

test.describe("production account and move journey", () => {
  test.skip(
    liveRequirements.length > 0,
    `Live production E2E is intentionally disabled. Configure: ${liveRequirements.join(
      ", ",
    )}.`,
  );

  test("persists a completed move plan and its core records across sessions", async ({
    page,
  }, testInfo) => {
    const token = `${Date.now()}-${testInfo.workerIndex}-${testInfo.retry}`;
    const email = `move-atlas-e2e-${token}@${emailDomain}`;
    const displayName = "Move Atlas E2E";
    const planName = `Production journey ${token}`;
    const propertyName = `Congress Avenue apartment ${token}`;
    const expenseName = `Rental truck estimate ${token}`;
    const boxNumber = String(900 + testInfo.retry);
    const roomName = `Kitchen ${token}`;
    const moveDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10);

    await test.step("create an account", async () => {
      await page.goto("/sign-up");
      await page.getByLabel("Your name").fill(displayName);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Create account" }).click();

      await expect(page).toHaveURL(/\/setup$/, { timeout: 30_000 });
    });

    await test.step("complete the guided setup", async () => {
      await expect(
        page.getByRole("heading", {
          name: "Who is this move organized around?",
          level: 1,
        }),
      ).toBeVisible();
      await page.getByLabel("Your name").fill(displayName);
      await page.getByLabel("Move plan name").fill(planName);
      await page.getByLabel("Household").selectOption({
        label: "Couple",
      });
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(
        page.getByRole("heading", {
          name: "Where are you going, and how firm is the date?",
          level: 1,
        }),
      ).toBeVisible();
      await page.getByLabel("Starting city or address").fill("Austin, TX");
      await page
        .getByLabel("Destination city or address")
        .fill("San Antonio, TX");
      await page.getByLabel("Target move date").fill(moveDate);
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(
        page.getByRole("heading", {
          name: "What kind of next home are you moving toward?",
          level: 1,
        }),
      ).toBeVisible();
      await page.getByLabel("Condo", { exact: true }).check();
      await page.getByLabel("Townhome", { exact: true }).check();
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(
        page.getByRole("heading", {
          name: "Set useful guardrails, not false precision.",
          level: 1,
        }),
      ).toBeVisible();
      await page.getByLabel("Monthly housing ceiling").fill("2400");
      await page.getByLabel("Savings available").fill("15000");
      await page.getByLabel("Move fund target").fill("8500");
      await page.getByLabel("Bedrooms").fill("2");
      await page.getByLabel("Bathrooms").fill("2");
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(
        page.getByRole("heading", {
          name: "What needs to work once the boxes are open?",
          level: 1,
        }),
      ).toBeVisible();
      await page.getByLabel("Pets traveling", { exact: true }).fill("Dog");
      await page.getByLabel("Groceries", { exact: true }).check();
      await page.getByLabel("Parks", { exact: true }).check();
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(
        page.getByRole("heading", {
          name: "Tell Area Intelligence what matters most to you.",
          level: 1,
        }),
      ).toBeVisible();
      await page.getByLabel("Shorter commute", { exact: true }).check();
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(
        page.getByRole("heading", {
          name: "We’ll shape the workspace around this move.",
          level: 1,
        }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Open my move" }).click();
      await expectWorkspace(page);
      await expect(
        page.getByRole("combobox", { name: "Switch move plan" }),
      ).toHaveValue(/.+/);
      await expect(page.locator(".topbar strong")).toHaveText(planName);
    });

    let areaName = "";
    await test.step("add an area with official evidence", async () => {
      await openSection(page, "Area intelligence", "areas");
      await page.getByLabel("Search for an area").fill("Austin, TX");
      await page.getByRole("button", { name: "Search areas" }).click();

      const results = page.getByRole("region", {
        name: "Place search results",
      });
      await expect(results).toBeVisible({ timeout: 60_000 });
      const firstResult = results.getByRole("button").first();
      await expect(firstResult).toBeVisible();
      areaName = (await firstResult.locator("strong").innerText()).trim();

      const createArea = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/areas",
        { timeout: 120_000 },
      );
      await firstResult.click();
      expect((await createArea).ok()).toBeTruthy();

      const ranking = page.locator(".area-ranking");
      await expect(ranking.getByText(areaName, { exact: true })).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.locator(".coverage-meter")).toBeVisible({
        timeout: 60_000,
      });
    });

    await test.step("add an apartment to Homes & rentals", async () => {
      await openSection(page, "Homes & rentals", "homes");
      const composer = page
        .locator("details.composer")
        .filter({ hasText: "+ Add a home or rental" });
      await composer.locator("summary").click();
      const form = composer.locator("form");
      await form.getByLabel("Listing label").fill(propertyName);
      await form.getByLabel("Property type").selectOption("apartment");
      await form
        .getByLabel("Address")
        .fill("1100 Congress Avenue, Austin, TX");
      await form.getByLabel("Asking cost").fill("2350");
      await form.getByLabel("Bedrooms").fill("2");
      await form.getByLabel("Bathrooms").fill("2");

      const createProperty = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          /\/records\/properties$/.test(new URL(response.url()).pathname),
      );
      await form.getByRole("button", { name: "Save to shortlist" }).click();
      expect((await createProperty).ok()).toBeTruthy();
      await expect(
        page.getByRole("heading", { name: propertyName, exact: true }),
      ).toBeVisible();
    });

    await test.step("create a real truck route and view NWS weather", async () => {
      await openSection(page, "Route command", "route");
      await page
        .getByLabel(
          "I checked the exact height on the vehicle or rental documentation.",
        )
        .check();

      const routeResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/routes/calculate",
        { timeout: 120_000 },
      );
      await page.getByRole("button", { name: "Compare real routes" }).click();
      expect((await routeResponse).ok()).toBeTruthy();

      await expect(
        page.getByRole("heading", { name: "Why this route?" }),
      ).toBeVisible({ timeout: 120_000 });
      await expect(page.getByLabel("Interactive route map")).toBeVisible();
      await expect(page.locator(".map-loading")).toBeHidden({
        timeout: 60_000,
      });
      await expect(
        page.getByRole("heading", {
          name: "Forecasts matched to expected arrival",
        }),
      ).toBeVisible();
      await expect(page.locator(".weather-timeline article").first()).toBeVisible({
        timeout: 90_000,
      });
    });

    await test.step("add a packing box", async () => {
      await openSection(page, "Move tools", "tools");
      await expect(
        page.getByRole("tab", { name: "Packing", selected: true }),
      ).toBeVisible();
      const form = page.locator("aside.sticky-form form");
      await form.getByLabel("Box number").fill(boxNumber);
      await form.getByLabel("Room").fill(roomName);
      await form.getByLabel("Destination room").fill("Kitchen");
      await form.getByLabel("Notes").fill("Fragile dishes");
      await form.getByLabel("Fragile").check();

      const createBox = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          /\/records\/boxes$/.test(new URL(response.url()).pathname),
      );
      await form.getByRole("button", { name: "Add item" }).click();
      expect((await createBox).ok()).toBeTruthy();
      await expect(
        page.getByRole("heading", {
          name: `Box ${boxNumber} · ${roomName}`,
          exact: true,
        }),
      ).toBeVisible();
    });

    await test.step("add a budget item", async () => {
      await openSection(page, "Budget", "budget");
      const composer = page
        .locator("details.composer")
        .filter({ hasText: "+ Add a budget item" });
      await composer.locator("summary").click();
      const form = composer.locator("form");
      await form.getByLabel("Expense").fill(expenseName);
      await form.getByLabel("Category").selectOption({
        label: "Moving service",
      });
      await form.getByLabel("Estimated").fill("1600");

      const createExpense = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          /\/records\/budget$/.test(new URL(response.url()).pathname),
      );
      await form.getByRole("button", { name: "Add expense" }).click();
      expect((await createExpense).ok()).toBeTruthy();
      await expect(page.getByText(expenseName, { exact: true })).toBeVisible();
    });

    await test.step("sign out and sign back in", async () => {
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/$/);

      await page.goto("/sign-in");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expectWorkspace(page);
      await expect(page.locator(".topbar strong")).toHaveText(planName);
    });

    await test.step("confirm records and the saved route persist", async () => {
      await openSection(page, "Area intelligence", "areas");
      await expect(
        page.locator(".area-ranking").getByText(areaName, { exact: true }),
      ).toBeVisible();

      await openSection(page, "Homes & rentals", "homes");
      await expect(
        page.getByRole("heading", { name: propertyName, exact: true }),
      ).toBeVisible();

      await openSection(page, "Move tools", "tools");
      await expect(
        page.getByRole("heading", {
          name: `Box ${boxNumber} · ${roomName}`,
          exact: true,
        }),
      ).toBeVisible();

      await openSection(page, "Budget", "budget");
      await expect(page.getByText(expenseName, { exact: true })).toBeVisible();

      const exportResponse = await page.request.get("/api/account/export");
      expect(exportResponse.status()).toBe(200);
      const accountExport = (await exportResponse.json()) as {
        schema: string;
        data: Record<string, Array<Record<string, unknown>>>;
      };
      expect(accountExport.schema).toBe("move-atlas-export-v1");
      expect(accountExport.data.areas?.length).toBeGreaterThan(0);
      expect(accountExport.data.properties?.length).toBeGreaterThan(0);
      expect(accountExport.data.packing_boxes?.length).toBeGreaterThan(0);
      expect(accountExport.data.budget_items?.length).toBeGreaterThan(0);
      expect(accountExport.data.saved_route_plans?.length).toBeGreaterThan(0);
    });
  });
});
