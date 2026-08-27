import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PersonTagInput } from "@logger/shared";
import { PeopleTagInput } from "./PeopleTagInput.js";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

/** Controlled wrapper so the component behaves as it does in a real form. */
function Harness({ initial = [] as PersonTagInput[] }) {
  const [value, setValue] = useState<PersonTagInput[]>(initial);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <PeopleTagInput value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </QueryClientProvider>
  );
}

describe("PeopleTagInput", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
  });

  it("adds a new person by typing a name and pressing Enter", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByPlaceholderText(/Add a person/), "Sarah{Enter}");

    expect(screen.getByText("Sarah")).toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify([{ name: "Sarah" }]));
  });

  it("removes a tag via its remove button", async () => {
    render(<Harness initial={[{ name: "Sarah" }, { name: "Jamie" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Sarah" }));

    expect(screen.queryByText("Sarah")).not.toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify([{ name: "Jamie" }]));
  });

  it("does not add a duplicate name", async () => {
    render(<Harness initial={[{ name: "Sarah" }]} />);
    await userEvent.type(screen.getByPlaceholderText(/Add a person/), "Sarah{Enter}");
    expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify([{ name: "Sarah" }]));
  });

  it("adds an existing person from the autocomplete list by id", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 12, title: "Sarah", category: "person" }]),
    );
    render(<Harness />);
    await userEvent.type(screen.getByPlaceholderText(/Add a person/), "Sar");

    const option = await screen.findByRole("button", { name: "Sarah" });
    await userEvent.click(option);

    expect(screen.getByTestId("value")).toHaveTextContent(
      JSON.stringify([{ id: 12, name: "Sarah" }]),
    );
  });
});
