/**
 * Shareable-URL helpers for the Remotion editor.
 *
 * A "shared project" is the `TimelineState` JSON compressed with lz-string
 * (URI-safe base64 → URL fragment as `#p=...`). We use the URL hash so the
 * share URL never reaches the server (no analytics, no third-party reads).
 *
 * Browser URL length limits vary from 2k-32k chars by browser. We preview
 * the encoded length and surface a fallback toast if it would blow the cap.
 */

import LZString from "lz-string";
import {
  PROJECT_FILE_KIND,
  PROJECT_FILE_VERSION,
  type ProjectFile,
  type TimelineState,
} from "compositions/types";

/** Conservative URL length cap. ~32k covers most browsers. */
const MAX_URL_LENGTH = 24000;

/** Search-param hash marker so old `?p=` links still work. */
export const SHARE_PARAM = "p";
/** Hash-fragment marker for backwards compat with the spec's `#project=`. */
export const SHARE_HASH = "project";

/**
 * Compress + encode a TimelineState for embedding in a URL.
 * Returns the encoded payload string (NOT the full URL).
 */
export function encodeTimeline(timeline: TimelineState): string {
  const json = JSON.stringify(timeline);
  return LZString.compressToEncodedURIComponent(json);
}

/** Decode a payload back into a TimelineState. Throws on parse failure. */
export function decodeTimeline(payload: string): TimelineState {
  const json = LZString.decompressFromEncodedURIComponent(payload);
  if (!json) throw new Error("share: payload did not decode");
  const parsed = JSON.parse(json) as TimelineState;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("share: payload is not an object");
  }
  if (
    !Array.isArray(parsed.clips) ||
    !Array.isArray(parsed.audioClips) ||
    !Array.isArray(parsed.textClips)
  ) {
    throw new Error("share: missing clips/audioClips/textClips arrays");
  }
  return parsed;
}

/**
 * Build a ProjectFile from a TimelineState. The ProjectFile shape is what
 * we save to disk - the same JSON we want to embed in a URL is the inner
 * `timeline` field, but we wrap with version/kind so URL shares don't
 * accidentally accept v1 / v0 timelines.
 */
export function buildProject(timeline: TimelineState, name: string): ProjectFile {
  return {
    version: PROJECT_FILE_VERSION,
    kind: PROJECT_FILE_KIND,
    name: name?.trim() || "shared",
    savedAt: new Date().toISOString(),
    timeline,
  };
}

/** Parse a ProjectFile from a URL hash payload (with the same kind check). */
export function parseProject(payload: string): ProjectFile {
  const json = LZString.decompressFromEncodedURIComponent(payload);
  if (!json) throw new Error("share: payload did not decode");
  const parsed = JSON.parse(json) as ProjectFile;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("share: payload is not an object");
  }
  if (parsed.kind !== PROJECT_FILE_KIND) {
    throw new Error(`share: wrong kind "${parsed.kind}"`);
  }
  if (typeof parsed.version !== "number" || parsed.version > PROJECT_FILE_VERSION) {
    throw new Error(`share: unsupported version ${parsed.version}`);
  }
  if (!parsed.timeline || !Array.isArray(parsed.timeline.clips)) {
    throw new Error("share: missing timeline");
  }
  return parsed;
}

/** Encode a ProjectFile (used for both disk-save and URL-share). */
export function encodeProject(project: ProjectFile): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(project));
}

/** Build a shareable URL string for the supplied TimelineState.
 *  `maxLength` is injectable so tests can force the cap; defaults to the
 *  browser-safe 24k. */
export function buildShareUrl(
  timeline: TimelineState,
  name: string,
  origin: string = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "",
  maxLength: number = MAX_URL_LENGTH,
): { url: string; tooLong: boolean } {
  const project = buildProject(timeline, name);
  const payload = encodeProject(project);
  const url = `${origin}#${SHARE_HASH}=${payload}`;
  return { url, tooLong: url.length > maxLength };
}

/**
 * Read the shareable payload from the current URL hash OR search params.
 * Returns null if no payload, the decoder on success, throws on parse error.
 */
export function readSharedProjectFromLocation(
  mockLocation?: { hash: string; search: string },
): ProjectFile | null {
  const hash =
    mockLocation?.hash ??
    (typeof window !== "undefined" ? window.location.hash : "");
  const search =
    mockLocation?.search ??
    (typeof window !== "undefined" ? window.location.search : "");
  let payload: string | null = null;
  if (hash.includes(`${SHARE_HASH}=`)) {
    payload = hash.split(`${SHARE_HASH}=`)[1]?.split(/[&#]/)[0] ?? null;
  } else if (hash.includes(`${SHARE_PARAM}=`)) {
    payload = hash.split(`${SHARE_PARAM}=`)[1]?.split(/[&#]/)[0] ?? null;
  } else if (search.includes(`${SHARE_PARAM}=`)) {
    payload = search.split(`${SHARE_PARAM}=`)[1]?.split(/[&#]/)[0] ?? null;
  }
  if (!payload) return null;
  return parseProject(payload);
}
