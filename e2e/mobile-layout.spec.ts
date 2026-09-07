import { test, expect, type Page } from "@playwright/test";

/**
 * The mobile-layout net.
 *
 * Every other spec drives behaviour; this one guards the *shape* of the app on a phone,
 * which is the thing that regressed badly enough to need an overhaul. The project runs
 * `devices["Pixel 7"]` (412x915, ~20:9) — the real target — so these assertions are made
 * at the size that matters rather than at a desktop default.
 *
 * Screenshots land in e2e/.artifacts/screens (gitignored) as a by-product, which is the
 * only way to actually *look* at a CSS change: the jsdom unit suite renders no styles.
 */

/** Every route worth checking, and how to know the SPA has finished rendering it. */
const ROUTES: { path: string; ready: (page: Page) => Promise<unknown> }[] = [
  { path: "/", ready: (p) => p.getByRole("heading", { level: 1 }).waitFor() },
  { path: "/search", ready: (p) => p.getByRole("textbox").first().waitFor() },
  { path: "/add", ready: (p) => p.getByRole("heading", { level: 1 }).waitFor() },
  { path: "/add/movie", ready: (p) => p.getByRole("textbox").first().waitFor() },
  { path: "/add/album", ready: (p) => p.getByRole("textbox").first().waitFor() },
  { path: "/calendar", ready: (p) => p.getByRole("heading", { level: 1 }).waitFor() },
  { path: "/gallery", ready: (p) => p.getByRole("heading", { level: 1 }).waitFor() },
  // /albums renders its empty state: the seed fixture creates no albums, which is also why
  // there is no /album/:id here to check.
  { path: "/albums", ready: (p) => p.getByRole("heading", { level: 1 }).waitFor() },
  { path: "/entity/1", ready: (p) => p.getByRole("heading", { level: 1 }).waitFor() },
  { path: "/person/1", ready: (p) => p.getByRole("heading", { level: 1 }).waitFor() },
  { path: "/settings", ready: (p) => p.getByRole("heading", { level: 1 }).waitFor() },
  // Renders outside Layout, so it has neither header nor tab bar and needs its own
  // safe-area handling — which is exactly why it is worth checking here.
  { path: "/login", ready: (p) => p.getByRole("heading", { level: 1 }).waitFor() },
];

/** A filename-safe stem for a route path: "/add/movie" -> "add-movie", "/" -> "home". */
const slug = (path: string) => path.replace(/^\/$/, "home").replace(/^\//, "").replace(/\//g, "-");

async function open(page: Page, route: (typeof ROUTES)[number]) {
  await page.goto(route.path);
  await route.ready(page);
  // Let fonts and any lazy image settle so the geometry we measure is the final one.
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.describe("mobile layout", () => {
  for (const route of ROUTES) {
    test(`${route.path} fits the viewport width and clears the nav`, async ({ page }) => {
      await open(page, route);
      await page.screenshot({
        path: `e2e/.artifacts/screens/${slug(route.path)}.png`,
        fullPage: true,
      });

      // 1. Nothing may push the page sideways. A single overflowing element makes the
      //    whole app feel broken on a phone, and it is invisible on a desktop viewport.
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        // Name the culprits rather than just failing, or diagnosing this costs an hour.
        culprits: [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120)),
      }));
      expect(overflow.culprits, `elements overflowing ${route.path}`).toEqual([]);
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

      // 2. Scrolled to the very bottom, the last interactive element must clear the fixed
      //    tab bar. This is what `pb-24`-style guesswork gets wrong, and it silently
      //    strands a submit button on exactly the screens with the longest forms.
      //
      //    Note it scrolls the page rather than calling scrollIntoView({block:"end"}):
      //    that aligns the element to the *viewport* bottom, which is under the nav by
      //    definition, so it would fail even on a correct layout.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(100);

      const occluded = await page.evaluate(() => {
        const nav = document.querySelector("nav[aria-label='Navigation']");
        const main = document.querySelector("main");
        if (!nav || !main) return null;
        const last = [...main.querySelectorAll<HTMLElement>("a,button,input,select,textarea")]
          .filter((el) => el.getBoundingClientRect().height > 0)
          .at(-1);
        if (!last) return null;
        const rect = last.getBoundingClientRect();
        return {
          hidden: rect.bottom > nav.getBoundingClientRect().top,
          html: last.outerHTML.slice(0, 120),
        };
      });
      if (occluded) {
        expect(occluded.hidden, `last control hidden behind the nav: ${occluded.html}`).toBe(false);
      }
    });
  }

  test("every visible tap target is at least 44px tall", async ({ page }) => {
    // The pill remove buttons are a deliberate 36px: a 44px circle does not fit inside a
    // text pill. Everything else in the app observes the 44px floor.
    const FLOOR = 44;
    const ALLOWED_BELOW = 36;
    const offenders: string[] = [];

    for (const route of ROUTES) {
      await open(page, route);
      const small = await page.evaluate(
        ({ floor, allowed }) =>
          [...document.querySelectorAll<HTMLElement>("a,button,input,select,textarea")]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              if (r.height === 0 || r.width === 0) return false;
              // A disabled control is not a tap target — the read-only star ratings in
              // search results are five 24px buttons that nobody can press.
              if (el.matches(":disabled")) return false;
              // Prose links ("with Alice, Bob", a title inside a card that is itself a
              // link) are inline: the row around them is the tap target, not the word.
              if (getComputedStyle(el).display === "inline") return false;
              return r.height < floor && r.height !== allowed;
            })
            .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(el.getBoundingClientRect().height)}px`),
        { floor: FLOOR, allowed: ALLOWED_BELOW },
      );
      offenders.push(...small.map((s) => `${route.path}: ${s}`));
    }

    expect(offenders).toEqual([]);
  });

  test("the people tag input's dropdown and pills also meet the 44px floor", async ({ page }) => {
    // A blind spot in the check above: it only measures the *default* state of each route, so
    // it missed three 24px pill remove buttons that render only once a person is tagged, and
    // the create-a-new-person dropdown row, which renders only while typing. Both need their
    // own state to exist on screen at all.
    await page.goto("/add/hang_out");
    const input = page.getByPlaceholder("Add a person");
    await input.fill("Zzz Nobody");

    const createRow = page.getByRole("button", { name: /Create/ });
    await expect(createRow).toBeVisible();
    expect((await createRow.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    await createRow.click();
    const removeButton = page.getByRole("button", { name: /Remove Zzz Nobody/ });
    await expect(removeButton).toBeVisible();
    // Deliberately 36, not 44 — a 44px circle does not fit inside a text pill.
    expect((await removeButton.boundingBox())?.height).toBe(36);
  });

  test("the calendar grid keeps one height across 4-, 5- and 6-row months", async ({ page }) => {
    await page.goto("/calendar");
    await page.getByRole("heading", { level: 1 }).waitFor();

    const gridBox = async () => {
      const box = await page.locator("[data-calendar-grid]").boundingBox();
      return box ? Math.round(box.height) : null;
    };

    const heights: (number | null)[] = [await gridBox()];
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Next month" }).click();
      await page.waitForTimeout(150);
      heights.push(await gridBox());
    }

    expect(heights[0]).not.toBeNull();
    // A month grid that resizes as you page through the year makes everything below it
    // jump; that was the single worst thing about the old calendar.
    expect(new Set(heights).size, `grid heights across months: ${heights.join(", ")}`).toBe(1);
  });

  test("a toast renders above the tab bar, not behind it", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("heading", { level: 1 }).waitFor();
    // Any settings action that toasts will do; sync is always available.
    const syncButton = page.getByRole("button", { name: /sync/i }).first();
    await syncButton.click();

    const toast = page.locator("[role='status']").first();
    await expect(toast).toBeVisible();

    const clear = await page.evaluate(() => {
      const t = document.querySelector("[role='status']");
      const nav = document.querySelector("nav[aria-label='Navigation']");
      if (!t || !nav) return null;
      return t.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top;
    });
    expect(clear, "the toast overlaps the fixed nav").toBe(true);
  });
});
