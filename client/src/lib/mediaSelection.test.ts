import { describe, it, expect } from "vitest";
import { MAX_MEDIA_PER_LOG, rejectMediaSelection } from "./mediaSelection.js";

function file(type: string, size = 1024, name = "f"): File {
  const f = new File([new Uint8Array([1])], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

const MB = 1024 * 1024;

describe("rejectMediaSelection", () => {
  it("accepts an ordinary photo", () => {
    expect(rejectMediaSelection([file("image/jpeg")])).toBeNull();
  });

  it("accepts an mp4", () => {
    expect(rejectMediaSelection([file("video/mp4")])).toBeNull();
  });

  it("accepts an empty selection, which just means nothing was picked", () => {
    expect(rejectMediaSelection([])).toBeNull();
  });

  it("rejects a format the server does not accept", () => {
    expect(rejectMediaSelection([file("video/quicktime")])).toMatch(/images and mp4/i);
    expect(rejectMediaSelection([file("application/pdf")])).toMatch(/images and mp4/i);
  });

  it("rejects the whole selection if any one file is the wrong format", () => {
    expect(rejectMediaSelection([file("image/jpeg"), file("video/webm")])).toMatch(/images and mp4/i);
  });

  it("rejects a photo over 10MB", () => {
    expect(rejectMediaSelection([file("image/jpeg", 11 * MB)])).toMatch(/10MB or smaller/);
  });

  it("accepts a photo right on the limit", () => {
    expect(rejectMediaSelection([file("image/jpeg", 10 * MB)])).toBeNull();
  });

  it("rejects a video over 250MB, with the video wording", () => {
    expect(rejectMediaSelection([file("video/mp4", 251 * MB)])).toMatch(/250MB or smaller/);
  });

  it("accepts a video that would be far too large as a photo", () => {
    expect(rejectMediaSelection([file("video/mp4", 200 * MB)])).toBeNull();
  });

  it("rejects more files than the cap allows", () => {
    const many = Array.from({ length: MAX_MEDIA_PER_LOG + 1 }, () => file("image/jpeg"));
    expect(rejectMediaSelection(many)).toMatch(/at most 10/);
  });

  it("counts what the record already holds towards the cap", () => {
    expect(rejectMediaSelection([file("image/jpeg")], { existingCount: MAX_MEDIA_PER_LOG })).toMatch(
      /at most 10/,
    );
    expect(
      rejectMediaSelection([file("image/jpeg")], { existingCount: MAX_MEDIA_PER_LOG - 1 }),
    ).toBeNull();
  });

  it("names the subject in the cap message", () => {
    const many = Array.from({ length: MAX_MEDIA_PER_LOG + 1 }, () => file("image/jpeg"));
    expect(rejectMediaSelection(many, { subject: "An album" })).toMatch(/^An album/);
  });

  it("honours a custom cap", () => {
    expect(rejectMediaSelection([file("image/jpeg"), file("image/jpeg")], { max: 1 })).toMatch(
      /at most 1/,
    );
  });

  it("reports the count problem before the format one", () => {
    const many = Array.from({ length: MAX_MEDIA_PER_LOG + 1 }, () => file("video/webm"));
    expect(rejectMediaSelection(many)).toMatch(/at most 10/);
  });
});
