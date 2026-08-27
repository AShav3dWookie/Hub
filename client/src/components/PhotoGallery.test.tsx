import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { PhotoGallery } from "./PhotoGallery.js";
import type { LogPhotoDTO } from "@logger/shared";

const NOW = "2024-05-01T00:00:00.000Z";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function photo(id: number): LogPhotoDTO {
  return {
    id,
    logId: 7,
    url: `/api/photos/full-${id}.jpg`,
    thumbnailUrl: `/api/photos/thumb-${id}.webp`,
    originalName: `photo-${id}.jpg`,
    createdAt: NOW,
  };
}

describe("PhotoGallery", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders a thumbnail per photo", () => {
    renderWithProviders(<PhotoGallery logId={7} photos={[photo(1), photo(2)]} />);
    const thumbs = screen.getAllByRole("img");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]).toHaveAttribute("src", "/api/photos/thumb-1.webp");
  });

  it("opens and closes a lightbox with the full-size image", async () => {
    renderWithProviders(<PhotoGallery logId={7} photos={[photo(1)]} />);

    await userEvent.click(screen.getByRole("button", { name: "photo-1.jpg" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("img")).toHaveAttribute("src", "/api/photos/full-1.jpg");

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms before deleting and calls the delete endpoint", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(undefined, 204));

    renderWithProviders(<PhotoGallery logId={7} photos={[photo(3)]} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete photo-3.jpg" }));
    expect(screen.getByText("Delete this photo?")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/logs/7/photos/3",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("uploads picked files as multipart form data without a JSON content-type", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse([photo(9)], 201));

    renderWithProviders(<PhotoGallery logId={7} photos={[]} />);

    const input = screen.getByTestId("photo-file-input");
    await userEvent.upload(input, new File(["x"], "beach.png", { type: "image/png" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/logs/7/photos");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).getAll("photos")).toHaveLength(1);
    expect(init.headers?.["Content-Type"]).toBeUndefined();
  });

  it("hides the add control once the 10-photo limit is reached", () => {
    const photos = Array.from({ length: 10 }, (_, i) => photo(i + 1));
    renderWithProviders(<PhotoGallery logId={7} photos={photos} />);
    expect(screen.queryByRole("button", { name: /add photos/i })).not.toBeInTheDocument();
  });
});
