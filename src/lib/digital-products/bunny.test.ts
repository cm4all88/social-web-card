import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareVideoUpload, signedVideoUrl } from "./bunny.server";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("Bunny Stream video access", () => {
  beforeEach(() => {
    vi.stubEnv("BUNNY_STREAM_LIBRARY_ID", "123");
    vi.stubEnv("BUNNY_STREAM_KEY", "upload-key");
    vi.stubEnv("BUNNY_STREAM_EMBED_TOKEN_KEY", "separate-playback-key");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns an expiring, video-scoped upload signature without exposing the library key", async () => {
    const fetchVideo = vi.fn(async () => Response.json({ guid: "video-id" }));
    vi.stubGlobal("fetch", fetchVideo);
    const video = await prepareVideoUpload("Sample");
    const expiration = Math.floor(Date.now() / 1000) + 3600;

    expect(fetchVideo).toHaveBeenCalledWith(
      "https://video.bunnycdn.com/library/123/videos",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ AccessKey: "upload-key" }),
      }),
    );
    expect(video.headers).toEqual({
      AuthorizationSignature: hash(`123upload-key${expiration}video-id`),
      AuthorizationExpire: String(expiration),
      LibraryId: "123",
      VideoId: "video-id",
    });
    expect(JSON.stringify(video)).not.toContain("upload-key");
  });

  it("creates a five-minute embed token with the separate playback key", () => {
    const url = new URL(signedVideoUrl("video-id"));
    const expiration = Math.floor(Date.now() / 1000) + 300;
    expect(url.pathname).toBe("/embed/123/video-id");
    expect(url.searchParams.get("expires")).toBe(String(expiration));
    expect(url.searchParams.get("token")).toBe(hash(`separate-playback-keyvideo-id${expiration}`));
  });

  it("fails closed without the playback key", () => {
    vi.stubEnv("BUNNY_STREAM_EMBED_TOKEN_KEY", "");
    expect(() => signedVideoUrl("video-id")).toThrow("Video hosting is not configured");
  });
});
