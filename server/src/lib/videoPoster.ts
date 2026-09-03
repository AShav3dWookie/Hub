import { execFile } from "node:child_process";
import { config } from "../config.js";

/** Wall-clock budget for the ffmpeg call — a poster frame is a sub-second operation. */
const FFMPEG_TIMEOUT_MS = 15_000;
/** Enough headroom for one decoded PNG frame on stdout. */
const FFMPEG_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Decode a single frame ~1s into `inputPath` and return it as a PNG buffer. ffmpeg is used
 * only to *decode* — the caller runs the result through the same sharp resize/webp recipe as
 * photo thumbnails, so we don't depend on ffmpeg's (build-variable) webp encoder.
 *
 * Rejects if ffmpeg is missing (ENOENT), exits non-zero, or produces no frame. Callers treat
 * any rejection as "fall back to a placeholder poster".
 */
export function extractPosterFrame(inputPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      config.ffmpegPath,
      [
        "-loglevel",
        "error",
        "-ss",
        "1",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1",
      ],
      { encoding: "buffer", timeout: FFMPEG_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const frame = stdout as unknown as Buffer;
        if (!frame || frame.length === 0) {
          reject(new Error("ffmpeg produced no poster frame"));
          return;
        }
        resolve(frame);
      },
    );
    // execFile's callback misses the synchronous spawn error on some platforms.
    child.on("error", reject);
  });
}
