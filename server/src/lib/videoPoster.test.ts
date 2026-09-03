import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { extractPosterFrame } from "./videoPoster.js";

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("videoPoster.extractPosterFrame", () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.FFMPEG_PATH;
  });

  it("rejects (rather than hangs) when ffmpeg is missing", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-"));
    process.env.FFMPEG_PATH = path.join(dir, "no-such-ffmpeg");
    const input = path.join(dir, "clip.mp4");
    fs.writeFileSync(input, Buffer.from("not a video"));

    await expect(extractPosterFrame(input)).rejects.toThrow();
  });

  it("rejects when ffmpeg cannot decode the input", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-"));
    const input = path.join(dir, "clip.mp4");
    fs.writeFileSync(input, Buffer.from("not a video"));

    await expect(extractPosterFrame(input)).rejects.toThrow();
  });

  it.skipIf(!hasFfmpeg())("decodes a real frame to a PNG buffer sharp can read", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-"));
    const input = path.join(dir, "clip.mp4");
    execFileSync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=96x64:d=2",
      "-pix_fmt",
      "yuv420p",
      input,
    ]);

    const frame = await extractPosterFrame(input);
    const meta = await sharp(frame).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(96);
  });
});
