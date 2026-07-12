import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import LZString from "lz-string";
import {
  encodeTimeline,
  decodeTimeline,
  buildProject,
  encodeProject,
  parseProject,
  buildShareUrl,
  readSharedProjectFromLocation,
} from "./share";
import { PROJECT_FILE_KIND, PROJECT_FILE_VERSION, type TimelineState } from "compositions/types";

const baseTimeline: TimelineState = {
  fps: 30,
  width: 1280,
  height: 720,
  backgroundColor: "#000000",
  clips: [],
  audioClips: [],
  textClips: [],
};

describe("encodeTimeline / decodeTimeline", () => {
  it("round-trips an empty timeline", () => {
    const encoded = encodeTimeline(baseTimeline);
    const decoded = decodeTimeline(encoded);
    expect(decoded.fps).toBe(30);
    expect(decoded.width).toBe(1280);
    expect(decoded.clips).toEqual([]);
    expect(decoded.audioClips).toEqual([]);
    expect(decoded.textClips).toEqual([]);
  });

  it("round-trips a populated timeline", () => {
    const tl: TimelineState = {
      ...baseTimeline,
      clips: [
        {
          id: "c1",
          name: "hello",
          type: "image",
          src: "https://x/y.png",
          trim: { from: 0, to: 3 },
          start: 1,
          scale: 1.2,
          opacity: 0.8,
          rotation: 5,
          entrance: {
            enabled: false,
            spring: { mass: 0.5, damping: 10, stiffness: 100 },
            from: { scale: 0.6, opacity: 0, translateX: 0, translateY: 30 },
            duration: 0.5,
          },
          transitionIn: { type: "none", duration: 0.5 },
          transitionOut: { type: "fade", duration: 0.5 },
        },
      ],
      audioClips: [
        {
          id: "a1",
          name: "song",
          src: "https://x/m.mp3",
          trim: { from: 0, to: 10 },
          start: 0,
          volume: 1,
          fadeIn: 0.2,
          fadeOut: 0.4,
        },
      ],
      textClips: [
        {
          id: "t1",
          name: "title",
          text: "Hello",
          start: 2,
          duration: 3,
          x: 0,
          y: 0,
          fontFamily: "system-ui",
          fontSize: 64,
          fontWeight: 700,
          color: "#fff",
          textAlign: "center",
          backgroundOpacity: 0,
          entrance: {
            enabled: true,
            spring: { mass: 0.5, damping: 14, stiffness: 140 },
            from: { scale: 0.7, opacity: 0, translateX: 0, translateY: 30 },
            duration: 0.5,
          },
        },
      ],
    };
    const encoded = encodeTimeline(tl);
    const decoded = decodeTimeline(encoded);
    expect(decoded.clips[0].id).toBe("c1");
    expect(decoded.clips[0].transitionOut.type).toBe("fade");
    expect(decoded.audioClips[0].fadeOut).toBe(0.4);
    expect(decoded.textClips[0].text).toBe("Hello");
  });

  it("throws on garbage payload", () => {
    expect(() => decodeTimeline("not-a-real-payload-@#$")).toThrow();
    expect(() => decodeTimeline("")).toThrow();
  });

  it("rejects an object missing the clips array", () => {
    // Force a valid-enough lz-string that decodes to JSON.
    // Compress an object with no clips array.
    const LZ = LZString;
    const payload = LZ.compressToEncodedURIComponent(
      JSON.stringify({ fps: 30 }),
    );
    expect(() => decodeTimeline(payload)).toThrow(/arrays/);
  });
});

describe("buildProject / encodeProject / parseProject", () => {
  it("produces a tagged ProjectFile", () => {
    const p = buildProject(baseTimeline, "demo");
    expect(p.kind).toBe(PROJECT_FILE_KIND);
    expect(p.version).toBe(PROJECT_FILE_VERSION);
    expect(p.name).toBe("demo");
    expect(typeof p.savedAt).toBe("string");
    expect(p.timeline.fps).toBe(30);
  });

  it("round-trips via encodeProject + parseProject", () => {
    const p = buildProject(baseTimeline, "trip");
    const encoded = encodeProject(p);
    const back = parseProject(encoded);
    expect(back.name).toBe("trip");
    expect(back.timeline.width).toBe(1280);
  });

  it("rejects wrong kind", () => {
    const LZ = LZString;
    const payload = LZ.compressToEncodedURIComponent(
      JSON.stringify({ kind: "wrong", version: 1, timeline: baseTimeline }),
    );
    expect(() => parseProject(payload)).toThrow(/kind/);
  });

  it("rejects unsupported version", () => {
    const LZ = LZString;
    const payload = LZ.compressToEncodedURIComponent(
      JSON.stringify({
        kind: PROJECT_FILE_KIND,
        version: 99,
        timeline: baseTimeline,
      }),
    );
    expect(() => parseProject(payload)).toThrow(/version/);
  });

  it("rejects missing timeline", () => {
    const LZ = LZString;
    const payload = LZ.compressToEncodedURIComponent(
      JSON.stringify({ kind: PROJECT_FILE_KIND, version: 1 }),
    );
    expect(() => parseProject(payload)).toThrow(/timeline|clips/);
  });
});

describe("buildShareUrl", () => {
  it("returns a URL whose hash decodes to the original project", () => {
    const { url, tooLong } = buildShareUrl(baseTimeline, "hello", "https://app.local/");
    expect(tooLong).toBe(false);
    expect(url).toMatch(/^https:\/\/app\.local\/#project=/);
    const payload = url.split("#project=")[1];
    const back = parseProject(payload);
    expect(back.timeline.width).toBe(1280);
  });

  it("marks tooLong when URL exceeds cap", () => {
    // Build an extremely long timeline to blow the cap. Each clip's
    // text is unique so lz-string can't collapse the payload.
    const huge: TimelineState = {
      ...baseTimeline,
      textClips: Array.from({ length: 200 }).map((_, i) => ({
        id: `t${i}`,
        name: `t${i}`,
        text: `clip-${i}-${Math.random().toString(36).slice(2)}-${"x".repeat(120)}`,
        start: i,
        duration: 1,
        x: 0,
        y: 0,
        fontFamily: "system-ui",
        fontSize: 64,
        fontWeight: 700,
        color: "#fff",
        textAlign: "center",
        backgroundOpacity: 0,
        entrance: {
          enabled: true,
          spring: { mass: 0.5, damping: 14, stiffness: 140 },
          from: { scale: 0.7, opacity: 0, translateX: 0, translateY: 30 },
          duration: 0.5,
        },
      })),
    };
    const { tooLong } = buildShareUrl(huge, "huge", "https://app.local/", 500);
    expect(tooLong).toBe(true);
  });
});

describe("readSharedProjectFromLocation", () => {
  // jsdom refuses `window.location.search =` because it triggers a navigation.
  // We pass a mockLocation object so we don't have to mutate global state.
  const blank = { hash: "", search: "" };

  it("returns null when no payload", () => {
    expect(readSharedProjectFromLocation(blank)).toBeNull();
  });

  it("reads from #project= hash", () => {
    const project = buildProject(baseTimeline, "fromHash");
    const encoded = encodeProject(project);
    const back = readSharedProjectFromLocation({
      hash: `project=${encoded}`,
      search: "",
    });
    expect(back?.name).toBe("fromHash");
  });

  it("reads from #p= hash (legacy)", () => {
    const project = buildProject(baseTimeline, "legacy");
    const encoded = encodeProject(project);
    const back = readSharedProjectFromLocation({
      hash: `p=${encoded}`,
      search: "",
    });
    expect(back?.name).toBe("legacy");
  });

  it("reads from ?p= search param", () => {
    const project = buildProject(baseTimeline, "search");
    const encoded = encodeProject(project);
    const back = readSharedProjectFromLocation({
      hash: "",
      search: `?p=${encoded}`,
    });
    expect(back?.name).toBe("search");
  });

  it("falls back to window.location when mockLocation is omitted", () => {
    const project = buildProject(baseTimeline, "liveRead");
    const encoded = encodeProject(project);
    window.location.hash = `project=${encoded}`;
    window.location.search = "";
    expect(readSharedProjectFromLocation()?.name).toBe("liveRead");
    // Cleanup so other tests see a clean hash.
    window.location.hash = "";
  });
});
