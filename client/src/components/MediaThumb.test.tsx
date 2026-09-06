import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MediaThumb, neighbourSrc } from "./MediaThumb.js";

const photo = {
  kind: "photo" as const,
  url: "/api/photos/a.jpg",
  thumbnailUrl: "/api/photos/a_thumb.webp",
  originalName: "a.jpg",
};
const video = { ...photo, kind: "video" as const, originalName: "clip.mp4" };

describe("MediaThumb", () => {
  it("shows the thumbnail, named for the original file", () => {
    render(<MediaThumb photo={photo} />);
    const img = screen.getByAltText("a.jpg");
    expect(img).toHaveAttribute("src", "/api/photos/a_thumb.webp");
  });

  it("loads lazily, since grids can be long", () => {
    render(<MediaThumb photo={photo} />);
    expect(screen.getByAltText("a.jpg")).toHaveAttribute("loading", "lazy");
  });

  it("badges a video, so a poster frame is not mistaken for a still", () => {
    render(<MediaThumb photo={video} />);
    expect(screen.getByTestId("video-badge")).toBeInTheDocument();
  });

  it("does not badge a photo", () => {
    render(<MediaThumb photo={photo} />);
    expect(screen.queryByTestId("video-badge")).not.toBeInTheDocument();
  });

  it("takes a badge size, since the two grids use different tiles", () => {
    const { container } = render(<MediaThumb photo={video} badgeSize="h-8 w-8" />);
    expect(container.querySelector(".h-8.w-8")).toBeTruthy();
  });
});

describe("neighbourSrc", () => {
  it("uses the full image for a photo", () => {
    expect(neighbourSrc(photo)).toBe("/api/photos/a.jpg");
  });

  it("uses the poster frame for a video, which has no still to preload", () => {
    expect(neighbourSrc(video)).toBe("/api/photos/a_thumb.webp");
  });

  it("has nothing to preload past either end of the list", () => {
    expect(neighbourSrc(undefined)).toBeUndefined();
  });
});
