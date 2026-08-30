import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { AddCategory } from "./AddCategory.js";

function render(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/add/:category" element={<AddCategory />} />
      <Route path="/add" element={<div>add index</div>} />
    </Routes>,
    { route },
  );
}

describe("AddCategory", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
  });

  it("renders the log form for a loggable category", () => {
    render("/add/movie");
    expect(screen.getByRole("heading", { name: /Log a Movie/i })).toBeInTheDocument();
  });

  it("renders the person form for the person category", () => {
    render("/add/person");
    expect(screen.getByRole("button", { name: /create person/i })).toBeInTheDocument();
  });

  it("renders the album form for /add/album", () => {
    render("/add/album");
    expect(screen.getByRole("heading", { name: /create an album/i })).toBeInTheDocument();
  });

  it("redirects to /add for an unknown category", () => {
    render("/add/banana");
    expect(screen.getByText("add index")).toBeInTheDocument();
  });

  it("passes a ?date= query param through to the log form", () => {
    render("/add/hang_out?date=2024-02-20");
    const dateInput = screen
      .getByText("Date")
      .parentElement!.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(dateInput).toHaveValue("2024-02-20");
  });
});
