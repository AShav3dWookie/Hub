import { test, expect, type Page } from "@playwright/test";
import { gotoHome } from "./helpers/app";

/**
 * The tab bar's second row, driven the way a phone drives it.
 *
 * Swipes are dispatched as real touch events through CDP, not mouse events: a finger drag on
 * the bar is what the browser would also take as a scroll of the page beneath, which is what
 * the bar's `touch-action: none` prevents. A mouse drag never scrolls, so it could not show that.
 */

const nav = (page: Page) => page.getByRole("navigation", { name: "Navigation" });
const handle = (page: Page) => page.getByRole("button", { name: "More tabs" });
const shoppingTab = (page: Page) => nav(page).getByRole("link", { name: "Shopping" });

/** Drag a finger vertically from the centre of `from`, in steps, and lift it. */
async function swipe(page: Page, from: { x: number; y: number }, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  const point = (y: number) => [{ x: Math.round(from.x), y: Math.round(y) }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.y) });
  for (let i = 1; i <= 6; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(from.y + (dy * i) / 6),
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function centreOf(page: Page, locator: ReturnType<Page["getByRole"]>) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => gotoHome(page));

test("the handle opens the second row, and Shopping takes you there", async ({ page }) => {
  await expect(shoppingTab(page)).toHaveCount(0);
  await handle(page).tap();
  await expect(handle(page)).toHaveAttribute("aria-expanded", "true");

  await shoppingTab(page).tap();
  await expect(page).toHaveURL(/\/shopping$/);
  await expect(page.getByRole("heading", { name: "Shopping", level: 1 })).toBeVisible();
  // The row folds away behind you, the handle says where you are, and Shopping is a tab root.
  await expect(shoppingTab(page)).toHaveCount(0);
  await expect(page.getByTestId("nav-more-active")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
});

test("a finger swipe up the bar opens the row and a swipe down closes it", async ({ page }) => {
  // On a page that scrolls — the case where the browser could take the drag as a scroll and
  // cancel the gesture. Search lists every log, which overflows the phone screen.
  await page.goto("/search");
  await page.getByRole("textbox").first().waitFor();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight))
    .toBe(true);

  const scrollY = () => page.evaluate(() => window.scrollY);
  const before = await scrollY();

  const calendar = nav(page).getByRole("link", { name: "Calendar" });
  await swipe(page, await centreOf(page, calendar), -80);
  await expect(shoppingTab(page)).toBeVisible();
  // Starting the swipe on a tab didn't also follow it, and didn't drag the page along.
  await expect(page).toHaveURL(/\/search$/);
  expect(await scrollY()).toBe(before);

  await swipe(page, await centreOf(page, calendar), 80);
  await expect(shoppingTab(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/search$/);
});

test("a plain tap on a tab still navigates", async ({ page }) => {
  // The guard: swallowing the click that ends a swipe must not swallow an ordinary tap.
  await nav(page).getByRole("link", { name: "Calendar" }).tap();
  await expect(page).toHaveURL(/\/calendar$/);
});

test("a tap outside the bar closes the row without doing anything else", async ({ page }) => {
  await handle(page).tap();
  await expect(shoppingTab(page)).toBeVisible();

  await page.getByTestId("nav-more-backdrop").tap({ position: { x: 20, y: 200 } });
  await expect(shoppingTab(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test("Shopping stays lit on a list's own page", async ({ page }) => {
  await page.goto("/shopping");
  await page.getByRole("link", { name: /Sainsbury/ }).click();
  await expect(page).toHaveURL(/\/shopping\/\d+$/);

  await handle(page).tap();
  await expect(shoppingTab(page)).toHaveAttribute("aria-current", "page");
});
