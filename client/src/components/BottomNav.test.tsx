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

describe("BottomNav", () => {
  it("shows only Settings on the home screen", () => {
    renderNav(["/"]);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("shows Back, Home and Settings on other routes", () => {
    renderNav(["/gallery"]);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("Back pops history when there is in-app history", async () => {
    renderNav(["/", "/gallery"], 1);
    expect(screen.getByTestId("path")).toHaveTextContent("/gallery");

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/");
  });

  it("Back falls back to / on a fresh deep link (no history)", async () => {
    renderNav(["/gallery"]);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/");
  });

  it("Home navigates to /", async () => {
    renderNav(["/entity/5"]);
    await userEvent.click(screen.getByRole("link", { name: "Home" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/");
  });
});
