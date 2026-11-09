import { test, expect, type Page } from "@playwright/test";
import { gotoHome } from "./helpers/app";

/**
 * The hub's own log, end to end: mint a logs token in Settings, have a phone token send a voice
 * command, and read back what the hub made of it — the way `npm run hub:logs` does. The two
 * kinds of token can't do each other's jobs.
 */

const devices = (page: Page) => page.getByRole("heading", { name: "Devices" }).locator("..");

async function addToken(page: Page, name: string, kind: "device" | "logs"): Promise<string> {
  await page.goto("/settings");
  await devices(page).getByRole("textbox", { name: "New device name" }).fill(name);
  await devices(page).getByRole("combobox", { name: "What the token can do" }).selectOption(kind);
  await devices(page).getByRole("button", { name: "Add device" }).click();
  const token = devices(page).getByRole("textbox", { name: `Token for ${name}` });
  await expect(token).toHaveValue(/^hub_/);
  const value = await token.inputValue();
  await devices(page).getByRole("button", { name: "Done" }).click();
  return value;
}

test("a logs token reads what the hub made of a voice command, and nothing else", async ({ page }) => {
  await gotoHome(page);
  const tag = Date.now().toString(36);
  const phone = await addToken(page, `E2E phone ${tag}`, "device");
  const logs = await addToken(page, `E2E PC ${tag}`, "logs");
  await expect(devices(page).getByRole("listitem").filter({ hasText: `E2E PC ${tag}` })).toContainText("Logs only");

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const said = `add lychees ${tag}`;
  expect((await page.request.post("/api/voice", { headers: bearer(phone), data: { text: said } })).status()).toBe(200);

  const res = await page.request.get("/api/device/logs", {
    headers: bearer(logs),
    params: { source: "voice", since: "10m", format: "text" },
  });
  expect(res.status()).toBe(200);
  const line = (await res.text()).split("\n").find((l) => l.includes(said));
  expect(line).toMatch(new RegExp(`voice +"${said}" → add_to_list: Added`));

  // Each token to its own job.
  expect((await page.request.get("/api/device/logs", { headers: bearer(phone) })).status()).toBe(403);
  expect((await page.request.post("/api/voice", { headers: bearer(logs), data: { text: "add eggs" } })).status()).toBe(403);
});
