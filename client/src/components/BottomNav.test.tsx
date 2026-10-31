import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { BottomNav, SWIPE_THRESHOLD_PX } from "./BottomNav.js";

function Where() {
  return <div data-testid="path">{useLocation().pathname}</div>;
}

function renderNav(initialEntries: string[], initialIndex = initialEntries.length - 1) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
      <BottomNav />
    </MemoryRouter>,
  );
}

/** react-router marks the matched NavLink with aria-current="page". */
const activeTab = () => screen.getByRole("link", { current: "page" });

describe("BottomNav", () => {
  it("offers all five destinations on every screen", () => {
    renderNav(["/entity/5"]);
    for (const [label, href] of [
      ["Home", "/"],
      ["Search", "/search"],
      ["Add", "/add"],
      ["Calendar", "/calendar"],
      ["Gallery", "/gallery"],
    ]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("Home navigates to /", async () => {
    renderNav(["/entity/5"]);
    await userEvent.click(screen.getByRole("link", { name: "Home" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/");
  });

  it("marks the tab you are on as the current page", () => {
    renderNav(["/calendar"]);
    expect(activeTab()).toHaveAccessibleName("Calendar");
  });

  it("marks Home current only on / itself, not on every route beneath it", () => {
    renderNav(["/gallery"]);
    expect(activeTab()).toHaveAccessibleName("Gallery");
  });

  it("keeps Add lit while you are filling one of its forms", () => {
    renderNav(["/add/movie"]);
    expect(activeTab()).toHaveAccessibleName("Add");
  });

  it("marks no tab current on a screen the tab bar does not own", () => {
    renderNav(["/entity/5"]);
    expect(screen.queryByRole("link", { current: "page" })).not.toBeInTheDocument();
  });

  describe("the second row", () => {
    // jsdom has no PointerEvent; a MouseEvent subclass carries the clientY the swipe reads.
    beforeAll(() => {
      class PointerEventShim extends MouseEvent {
        pointerType: string;
        constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
          super(type, init);
          this.pointerType = init.pointerType ?? "touch";
        }
      }
      vi.stubGlobal("PointerEvent", PointerEventShim);
    });
    afterAll(() => vi.unstubAllGlobals());

    const handle = () => screen.getByRole("button", { name: "More tabs" });
    const shopping = () => screen.queryByRole("link", { name: "Shopping" });

    /** A finger down on `from`, dragged `dy` px, lifted — then the click a touch tap produces. */
    function swipe(from: Element, dy: number) {
      fireEvent.pointerDown(from, { clientY: 600, pointerType: "touch" });
      fireEvent.pointerMove(window, { clientY: 600 + dy / 2, pointerType: "touch" });
      fireEvent.pointerMove(window, { clientY: 600 + dy, pointerType: "touch" });
      fireEvent.pointerUp(window, { clientY: 600 + dy, pointerType: "touch" });
      fireEvent.click(from);
    }

    it("keeps Shopping out of reach until the bar is opened", () => {
      renderNav(["/"]);
      expect(shopping()).not.toBeInTheDocument();
      expect(handle()).toHaveAttribute("aria-expanded", "false");
    });

    it("opens and closes from the handle", async () => {
      renderNav(["/"]);
      await userEvent.click(handle());
      expect(shopping()).toHaveAttribute("href", "/shopping");
      expect(handle()).toHaveAttribute("aria-expanded", "true");

      await userEvent.click(handle());
      expect(shopping()).not.toBeInTheDocument();
    });

    it("opens on a swipe up the bar and closes on a swipe down", () => {
      renderNav(["/"]);
      swipe(screen.getByRole("navigation"), -60);
      expect(shopping()).toBeInTheDocument();

      swipe(screen.getByRole("navigation"), 60);
      expect(shopping()).not.toBeInTheDocument();
    });

    it("a swipe that starts on a tab opens the row instead of following the tab", () => {
      renderNav(["/calendar"]);
      swipe(screen.getByRole("link", { name: "Search" }), -60);

      expect(shopping()).toBeInTheDocument();
      expect(screen.getByTestId("path")).toHaveTextContent("/calendar");
    });

    it("ignores a drag too short to be a swipe, so a wobbly tap still works", () => {
      renderNav(["/calendar"]);
      swipe(screen.getByRole("link", { name: "Search" }), -(SWIPE_THRESHOLD_PX - 4));

      expect(shopping()).not.toBeInTheDocument();
      expect(screen.getByTestId("path")).toHaveTextContent("/search");
    });

    it("goes to Shopping and closes the row behind it", async () => {
      renderNav(["/"]);
      await userEvent.click(handle());
      await userEvent.click(shopping()!);

      expect(screen.getByTestId("path")).toHaveTextContent("/shopping");
      expect(handle()).toHaveAttribute("aria-expanded", "false");
    });

    it("closes on Escape and on a tap outside the bar", async () => {
      renderNav(["/"]);
      await userEvent.click(handle());
      await userEvent.keyboard("{Escape}");
      expect(shopping()).not.toBeInTheDocument();

      await userEvent.click(handle());
      await userEvent.click(screen.getByTestId("nav-more-backdrop"));
      expect(shopping()).not.toBeInTheDocument();
    });

    it("keeps Shopping lit on a list's own page", async () => {
      renderNav(["/shopping/4"]);
      await userEvent.click(handle());
      expect(activeTab()).toHaveAccessibleName("Shopping");
    });

    it("marks the handle while you're on a screen from the hidden row", () => {
      renderNav(["/shopping/4"]);
      expect(screen.getByTestId("nav-more-active")).toBeInTheDocument();
    });

    it("leaves the handle unmarked everywhere else", () => {
      renderNav(["/calendar"]);
      expect(screen.queryByTestId("nav-more-active")).not.toBeInTheDocument();
    });
  });
});
