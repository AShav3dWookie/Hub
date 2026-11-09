import { test, expect, type Page } from "@playwright/test";
import { gotoHome, syncFromSettings } from "./helpers/app";

/**
 * A voice command from a device, end to end: add the device in Settings, use its token the way
 * the companion app will, see the item on the list in the app, then remove the device and watch
 * the token stop working.
 *
 * The e2e hub's model is scripts/fakeVoiceModel.mjs (see e2e/serve.mjs), so this runs the real
 * model code path for free; the fake only knows "add <item> to <list>".
 */

const devices = (page: Page) => page.getByRole("heading", { name: "Devices" }).locator("..");

async function addDevice(page: Page, name: string): Promise<string> {
  await page.goto("/settings");
  await devices(page).getByRole("textbox", { name: "New device name" }).fill(name);
  await devices(page).getByRole("button", { name: "Add device" }).click();
  const token = devices(page).getByRole("textbox", { name: `Token for ${name}` });
  await expect(token).toHaveValue(/^hub_/);
  const value = await token.inputValue();
  await devices(page).getByRole("button", { name: "Done" }).click();
  return value;
}

test("a device adds to a list by voice, and stops working once removed", async ({ page }) => {
  await gotoHome(page);
  const tag = Date.now().toString(36);
  const name = `E2E phone ${tag}`;
  const token = await addDevice(page, name);

  const say = (text: string, bearer = token) =>
    page.request.post("/api/voice", {
      headers: { Authorization: `Bearer ${bearer}` },
      data: { text },
    });

  const res = await say(`add kumquats ${tag} to the sainsburys list`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { list: { name: string }; added: string[]; message: string };
  expect(body.list.name).toBe("Sainsbury's – Bangor");
  expect(body.added.map((i) => i.toLowerCase())).toEqual([`kumquats ${tag}`]);
  expect(body.message).toContain("Sainsbury's – Bangor");

  // The item reaches the app like any other change.
  await syncFromSettings(page);
  await page.goto("/shopping");
  await page.getByRole("link", { name: /Sainsbury/ }).click();
  await expect(page.getByText(new RegExp(`kumquats ${tag}`, "i"))).toBeVisible();

  // Settings shows the device as used.
  await page.goto("/settings");
  const row = devices(page).getByRole("listitem").filter({ hasText: name });
  await expect(row.getByText(/Last used (just now|\d+ min ago)/)).toBeVisible();

  // A wrong token never works; once removed, the real one doesn't either.
  expect((await say("add eggs", "hub_not-a-real-token")).status()).toBe(401);
  await row.getByRole("button", { name: `Remove ${name}` }).click();
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(devices(page).getByText(name)).toHaveCount(0);
  expect((await say("add eggs")).status()).toBe(401);
});
