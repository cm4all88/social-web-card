import { createHash } from "node:crypto";

function bunnyConfig() {
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_KEY;
  const tokenKey = process.env.BUNNY_STREAM_EMBED_TOKEN_KEY;
  if (!libraryId || !/^\d+$/.test(libraryId) || !apiKey || !tokenKey) {
    throw new Error("Video hosting is not configured.");
  }
  return { libraryId, apiKey, tokenKey };
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function videoRequest(path: string, init?: RequestInit) {
  const { libraryId, apiKey } = bunnyConfig();
  const result = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos${path}`, {
    ...init,
    headers: { AccessKey: apiKey, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!result.ok) throw new Error("Bunny Stream could not complete the request.");
  return result;
}

export async function prepareVideoUpload(title: string) {
  const { libraryId, apiKey } = bunnyConfig();
  const response = await videoRequest("", { method: "POST", body: JSON.stringify({ title }) });
  const { guid } = (await response.json()) as { guid: string };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  return {
    videoId: guid,
    headers: {
      AuthorizationSignature: sha256(`${libraryId}${apiKey}${expires}${guid}`),
      AuthorizationExpire: String(expires),
      VideoId: guid,
      LibraryId: libraryId,
    },
  };
}

export async function isVideoReady(id: string) {
  const response = await videoRequest(`/${encodeURIComponent(id)}`);
  const video = (await response.json()) as { status: number };
  return video.status === 4;
}

export function signedVideoUrl(id: string) {
  const { libraryId, tokenKey } = bunnyConfig();
  const expires = Math.floor(Date.now() / 1000) + 300;
  const token = sha256(`${tokenKey}${id}${expires}`);
  return `https://player.mediadelivery.net/embed/${libraryId}/${encodeURIComponent(id)}?token=${token}&expires=${expires}`;
}
