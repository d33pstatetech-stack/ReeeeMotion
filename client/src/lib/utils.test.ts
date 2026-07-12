import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  safeFilename,
  bgForKind,
  probeVideoDuration,
  probeAudioDuration,
  makeAudioClipFromAsset,
  downloadBlob,
  formatTime,
  formatTimecode,
  collectSnapPoints,
  snapSeconds,
  SNAP_THRESHOLD_PX,
} from "./utils";

describe("safeFilename", () => {
  it("strips slashes & special chars", () => {
    expect(safeFilename('a/b\\c:?*"<>|d')).toBe("a_b_c_d");
  });
  it("collapses whitespace", () => {
    expect(safeFilename("  hello   world  ")).toBe("hello_world");
  });
  it("clamps to 80 chars", () => {
    const long = "x".repeat(200);
    expect(safeFilename(long).length).toBe(80);
  });
  it("falls back to 'untitled' on empty input", () => {
    expect(safeFilename("")).toBe("untitled");
    expect(safeFilename("////")).toBe("untitled");
  });
});

describe("bgForKind", () => {
  it("returns a gradient for each known kind", () => {
    expect(bgForKind("video")).toMatch(/linear-gradient/);
    expect(bgForKind("image")).toMatch(/linear-gradient/);
    expect(bgForKind("audio")).toMatch(/linear-gradient/);
    // Audio should be visually distinct from video/image.
    expect(bgForKind("audio")).not.toBe(bgForKind("video"));
  });
});

describe("formatTime", () => {
  it("formats <60s as MM:SS", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(7)).toBe("00:07");
    expect(formatTime(59)).toBe("00:59");
  });
  it("formats >=60s with rollover minutes", () => {
    expect(formatTime(60)).toBe("01:00");
    expect(formatTime(125)).toBe("02:05");
  });
  it("clamps negatives to 00:00", () => {
    expect(formatTime(-5)).toBe("00:00");
  });
});

describe("probeVideoDuration", () => {
  it("resolves with the loaded video duration", async () => {
    const orig = document.createElement.bind(document);
    const stub: any = {
      preload: "",
      src: "",
      duration: 12.5,
      onloadedmetadata: null as null | (() => void),
      onerror: null as null | (() => void),
    };
    const create = vi.spyOn(document, "createElement");
    create.mockImplementation(((tag: string) => {
      if (tag === "video") {
        // Fire onloadedmetadata on next microtask, like the browser would.
        queueMicrotask(() => stub.onloadedmetadata?.());
        return stub;
      }
      return orig(tag);
    }) as typeof document.createElement);

    const dur = await probeVideoDuration("https://example.com/v.mp4");
    expect(dur).toBe(12.5);
    create.mockRestore();
  });

  it("falls back to 5 on error", async () => {
    const orig = document.createElement.bind(document);
    const stub: any = {
      preload: "",
      src: "",
      duration: 0,
      onloadedmetadata: null,
      onerror: null,
    };
    const create = vi.spyOn(document, "createElement");
    create.mockImplementation(((tag: string) => {
      if (tag === "video") {
        queueMicrotask(() => stub.onerror?.());
        return stub;
      }
      return orig(tag);
    }) as typeof document.createElement);
    const dur = await probeVideoDuration("https://example.com/bad.mp4");
    expect(dur).toBe(5);
    create.mockRestore();
  });
});

describe("probeAudioDuration", () => {
  it("resolves with the loaded audio duration", async () => {
    const orig = document.createElement.bind(document);
    const stub: any = {
      preload: "",
      src: "",
      duration: 33,
      onloadedmetadata: null as null | (() => void),
      onerror: null,
    };
    const create = vi.spyOn(document, "createElement");
    create.mockImplementation(((tag: string) => {
      if (tag === "audio") {
        queueMicrotask(() => stub.onloadedmetadata?.());
        return stub;
      }
      return orig(tag);
    }) as typeof document.createElement);
    const dur = await probeAudioDuration("https://example.com/a.mp3");
    expect(dur).toBe(33);
    create.mockRestore();
  });

  it("falls back to 5 on error", async () => {
    const orig = document.createElement.bind(document);
    const stub: any = {
      preload: "",
      src: "",
      duration: 0,
      onloadedmetadata: null,
      onerror: null,
    };
    const create = vi.spyOn(document, "createElement");
    create.mockImplementation(((tag: string) => {
      if (tag === "audio") {
        queueMicrotask(() => stub.onerror?.());
        return stub;
      }
      return orig(tag);
    }) as typeof document.createElement);
    const dur = await probeAudioDuration("https://example.com/bad.mp3");
    expect(dur).toBe(5);
    create.mockRestore();
  });
});

describe("makeAudioClipFromAsset", () => {
  it("returns defaults plus asset-derived fields", () => {
    const clip = makeAudioClipFromAsset({
      id: "a1",
      name: "track.mp3",
      url: "https://x/y.mp3",
      kind: "audio",
    });
    expect(clip.name).toBe("track.mp3");
    expect(clip.src).toBe("https://x/y.mp3");
    expect(clip.id).toMatch(/.+/);
    expect(clip.volume).toBe(1);
    expect(clip.fadeIn).toBe(0);
    expect(clip.fadeOut).toBe(0);
    expect(clip.trim.from).toBe(0);
    expect(clip.trim.to).toBe(5);
  });
});

describe("formatTimecode", () => {
  it("formats zero as 00:00:00:00", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00:00");
  });
  it("rolls seconds up across the SS:FF boundary without jumping a frame", () => {
    // 0.95s @ 30fps = 28.5 frames -> floors to frame 28.
    expect(formatTimecode(0.95, 30)).toBe("00:00:00:28");
    expect(formatTimecode(1.0, 30)).toBe("00:00:01:00");
  });
  it("handles minutes and hours", () => {
    expect(formatTimecode(65.5, 30)).toBe("00:01:05:15");
    expect(formatTimecode(3600, 30)).toBe("01:00:00:00");
    expect(formatTimecode(3661.5, 30)).toBe("01:01:01:15");
  });
  it("supports 60fps with the same total-frame math", () => {
    expect(formatTimecode(0.5, 60)).toBe("00:00:00:30");
    expect(formatTimecode(1.0, 60)).toBe("00:00:01:00");
  });
  it("supports 1 fps edge case (single-frame granularity)", () => {
    // 0.3s @ 1fps = 0.3 frames -> floors to 0
    expect(formatTimecode(0.3, 1)).toBe("00:00:00:00");
    // 1.0s @ 1fps = exactly 1 frame -> 00:00:01:00
    expect(formatTimecode(1.0, 1)).toBe("00:00:01:00");
  });
  it("clamps negatives to 00:00:00:00", () => {
    expect(formatTimecode(-5, 30)).toBe("00:00:00:00");
  });
  it("falls back to 30 fps when given 0 / NaN fps", () => {
    expect(formatTimecode(1, 0)).toBe("00:00:01:00");
    expect(formatTimecode(1, NaN as unknown as number)).toBe("00:00:01:00");
    expect(formatTimecode(1, -10 as unknown as number)).toBe("00:00:01:00");
  });
});

describe("collectSnapPoints", () => {
  it("always includes the timeline start (0) and the playhead", () => {
    const tl = mockTimeline();
    const pts = collectSnapPoints(tl, 30, undefined);
    expect(pts).toContainEqual({ sec: 0, source: "zero" });
    expect(pts).toContainEqual({ sec: 1, source: "playhead" }); // 30/30 = 1s
  });

  it("includes start + end of every clip (video/image, audio, text)", () => {
    const tl = mockTimeline();
    const vals = collectSnapPoints(tl, 0)
      .map((p) => p.sec)
      .sort((a, b) => a - b);
    // 0, video 5..10, audio 3..8, text 2..7
    expect(vals).toEqual([0, 2, 3, 5, 7, 8, 10]);
  });

  it("excludes the dragging clip's own edges", () => {
    const tl = mockTimeline();
    const pts = collectSnapPoints(tl, 0, "video-1");
    expect(pts.find((p) => p.sec === 5)).toBeUndefined();
    expect(pts.find((p) => p.sec === 10)).toBeUndefined();
  });
});

describe("snapSeconds", () => {
  const candidates = [
    { sec: 0, source: "zero" as const },
    { sec: 5, source: "clip" as const },
    { sec: 10, source: "clip" as const },
  ];

  it("snaps to the nearest candidate when within threshold", () => {
    // At 100 px/sec, 10px threshold = 0.1s -> 5.08 is well within range.
    const r = snapSeconds(5.08, candidates, 100);
    expect(r.sec).toBe(5);
    expect(r.guide).toEqual({ sec: 5, source: "clip" });
  });

  it("returns the input unchanged when no candidate is close enough", () => {
    const r = snapSeconds(7.5, candidates, 100);
    expect(r.sec).toBe(7.5);
    expect(r.guide).toBeNull();
  });

  it("uses pxPerSec to derive the threshold lazily", () => {
    // At 800 px/sec the same 10px threshold = 0.0125s -> 5.011 is in-range.
    const r = snapSeconds(5.011, candidates, 800);
    expect(r.sec).toBe(5);
  });

  it("prefers the closer candidate when multiple are within range", () => {
    expect(snapSeconds(0.08, candidates, 100).sec).toBe(0);
    expect(snapSeconds(4.95, candidates, 100).sec).toBe(5);
  });

  it("exports a stable default threshold in pixels", () => {
    expect(SNAP_THRESHOLD_PX).toBe(10);
  });
});

function mockTimeline() {
  return {
    fps: 30,
    clips: [{ id: "video-1", start: 5, trim: { from: 0, to: 5 } }],
    audioClips: [{ id: "audio-1", start: 3, trim: { from: 0, to: 5 } }],
    textClips: [{ id: "text-1", start: 2, duration: 5 }],
  };
}

describe("downloadBlob", () => {
  it("triggers an anchor click and revokes the URL", async () => {
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    const origAppend = document.body.appendChild.bind(document.body);
    const origRevoke = URL.revokeObjectURL;

    const fakeAnchor: any = {
      href: "",
      download: "",
      click: clickSpy,
      remove: vi.fn(),
    };
    const create = vi.spyOn(document, "createElement");
    create.mockImplementation(((tag: string) => {
      if (tag === "a") return fakeAnchor;
      return origCreate(tag);
    }) as typeof document.createElement);
    const appendSpy = vi
      .spyOn(document.body, "appendChild")
      .mockImplementation(((node: Node) => origAppend(node)) as typeof document.body.appendChild);
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;

    downloadBlob(new Blob(["x"]), "file.json");
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(fakeAnchor.download).toBe("file.json");
    // Revoke happens via setTimeout(..., 1000) - just verify the call eventually arrives.
    await new Promise((r) => setTimeout(r, 1100));
    expect(revoke).toHaveBeenCalled();

    URL.revokeObjectURL = origRevoke;
    create.mockRestore();
    appendSpy.mockRestore();
  });
});
