import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav.js";

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
});
