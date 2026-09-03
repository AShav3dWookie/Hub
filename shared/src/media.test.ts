import { describe, it, expect } from "vitest";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_MEDIA_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MEDIA_ACCEPT_ATTR,
  extForMime,
  isAllowedMediaMime,
  maxBytesForMime,
  mediaKindForMime,
} from "./media.js";

describe("the allow-list tables", () => {
  it("unions the image and video tables", () => {
    for (const mime of Object.keys(ALLOWED_IMAGE_MIME_TYPES)) {
      expect(ALLOWED_MEDIA_MIME_TYPES[mime]).toBe(ALLOWED_IMAGE_MIME_TYPES[mime]);
    }
    for (const mime of Object.keys(ALLOWED_VIDEO_MIME_TYPES)) {
      expect(ALLOWED_MEDIA_MIME_TYPES[mime]).toBe(ALLOWED_VIDEO_MIME_TYPES[mime]);
    }
    const total =
      Object.keys(ALLOWED_IMAGE_MIME_TYPES).length + Object.keys(ALLOWED_VIDEO_MIME_TYPES).length;
    expect(Object.keys(ALLOWED_MEDIA_MIME_TYPES)).toHaveLength(total);
  });

  it("allows mp4 as the only video container", () => {
    expect(Object.keys(ALLOWED_VIDEO_MIME_TYPES)).toEqual(["video/mp4"]);
  });

  it("maps every allowed type to a non-empty extension", () => {
    for (const [mime, ext] of Object.entries(ALLOWED_MEDIA_MIME_TYPES)) {
      expect(ext, `no extension for ${mime}`).toMatch(/^[a-z0-9]+$/);
    }
  });
});

describe("isAllowedMediaMime", () => {
  it.each(Object.keys(ALLOWED_MEDIA_MIME_TYPES))("allows %s", (mime) => {
    expect(isAllowedMediaMime(mime)).toBe(true);
  });

  it.each(["video/quicktime", "video/webm", "application/pdf", "text/plain", ""])(
    "rejects %s",
    (mime) => {
      expect(isAllowedMediaMime(mime)).toBe(false);
    },
  );
});

describe("mediaKindForMime", () => {
  it("classifies mp4 as video", () => {
    expect(mediaKindForMime("video/mp4")).toBe("video");
  });

  it.each(Object.keys(ALLOWED_IMAGE_MIME_TYPES))("classifies %s as photo", (mime) => {
    expect(mediaKindForMime(mime)).toBe("photo");
  });

  it("falls back to photo for an unknown type, since every legacy row is an image", () => {
    expect(mediaKindForMime("application/octet-stream")).toBe("photo");
  });
});

describe("extForMime", () => {
  it("returns the stored extension for an allowed type", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("video/mp4")).toBe("mp4");
  });

  it("returns undefined for a type that is not allowed", () => {
    expect(extForMime("video/webm")).toBeUndefined();
  });
});

describe("maxBytesForMime", () => {
  it("gives video the larger cap", () => {
    expect(maxBytesForMime("video/mp4")).toBe(MAX_VIDEO_BYTES);
    expect(MAX_VIDEO_BYTES).toBeGreaterThan(MAX_IMAGE_BYTES);
  });

  it.each(Object.keys(ALLOWED_IMAGE_MIME_TYPES))("gives %s the image cap", (mime) => {
    expect(maxBytesForMime(mime)).toBe(MAX_IMAGE_BYTES);
  });

  it("applies the image cap to an unknown type, matching the photo fallback", () => {
    expect(maxBytesForMime("application/octet-stream")).toBe(MAX_IMAGE_BYTES);
  });
});

describe("MEDIA_ACCEPT_ATTR", () => {
  it("lists every allowed type so no upload input can drift from the allow-list", () => {
    const listed = MEDIA_ACCEPT_ATTR.split(",");
    expect(listed.sort()).toEqual(Object.keys(ALLOWED_MEDIA_MIME_TYPES).sort());
  });

  it("includes mp4, so pickers offer video", () => {
    expect(MEDIA_ACCEPT_ATTR).toContain("video/mp4");
  });
});
