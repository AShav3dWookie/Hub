import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { Settings } from "./Settings.js";

vi.mock("../api/localHooks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/localHooks.js")>();
  return { ...actual, useOnlineStatus: vi.fn(() => true) };
});
import { useOnlineStatus } from "../api/localHooks.js";

/**
 * The Devices section, against a small in-memory stand-in for the server's device-token
 * endpoints. Assertions are about what the screen shows; the fake only plays the server.
 */
let devices: { id: number; name: string; createdAt: string; lastUsedAt: string | null }[];
let nextId: number;

function fakeServer(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));
  if (!url.includes("/api/device-tokens")) return json({ error: "not faked" }, 404);

  const method = init?.method ?? "GET";
  if (method === "GET") return json(devices);
  if (method === "POST") {
    const { name } = JSON.parse(String(init?.body)) as { name: string };
    const device = { id: nextId++, name, createdAt: new Date().toISOString(), lastUsedAt: null };
    devices.push(device);
    return json({ ...device, token: `hub_secret-for-${name.replace(/\s/g, "-")}` }, 201);
  }
  if (method === "DELETE") {
    const id = Number(url.split("/").pop());
    devices = devices.filter((d) => d.id !== id);
    return json(undefined, 204);
  }
  return json({ error: "unexpected" }, 500);
}

const section = () => screen.getByRole("heading", { name: "Devices" }).parentElement!;

describe("Settings → Devices", () => {
  beforeEach(() => {
    devices = [
      { id: 1, name: "Old tablet", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: null },
    ];
    nextId = 2;
    vi.stubGlobal("fetch", vi.fn(fakeServer));
    vi.mocked(useOnlineStatus).mockReturnValue(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists the devices that have a token", async () => {
    renderWithProviders(<Settings />);
    expect(await within(section()).findByText("Old tablet")).toBeInTheDocument();
    expect(within(section()).getByText("Last used never")).toBeInTheDocument();
  });

  it("adds a device and shows its token once, to copy into it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await within(section()).findByText("Old tablet");

    await user.type(within(section()).getByRole("textbox", { name: "New device name" }), "Pixel 6");
    await user.click(within(section()).getByRole("button", { name: "Add device" }));

    const token = await within(section()).findByRole("textbox", { name: "Token for Pixel 6" });
    expect(token).toHaveValue("hub_secret-for-Pixel-6");
    expect(within(section()).getByText(/won't be shown again/)).toBeInTheDocument();
    expect(await within(section()).findByText("Pixel 6")).toBeInTheDocument();

    await user.click(within(section()).getByRole("button", { name: "Done" }));
    expect(within(section()).queryByRole("textbox", { name: "Token for Pixel 6" })).not.toBeInTheDocument();
    expect(within(section()).getByText("Pixel 6")).toBeInTheDocument();
  });

  it("removes a device only after confirming", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await user.click(await within(section()).findByRole("button", { name: "Remove Old tablet" }));
    expect(within(section()).getByText(/It stops working straight away/)).toBeInTheDocument();

    await user.click(within(section()).getByRole("button", { name: "Cancel" }));
    expect(within(section()).getByText("Old tablet")).toBeInTheDocument();

    await user.click(within(section()).getByRole("button", { name: "Remove Old tablet" }));
    await user.click(within(section()).getByRole("button", { name: "Remove" }));
    await vi.waitFor(() => expect(within(section()).queryByText("Old tablet")).not.toBeInTheDocument());
  });

  it("can't be managed offline", async () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);
    renderWithProviders(<Settings />);
    expect(within(section()).getByText("Reconnect to manage devices.")).toBeInTheDocument();
    expect(within(section()).getByRole("textbox", { name: "New device name" })).toBeDisabled();
  });
});
