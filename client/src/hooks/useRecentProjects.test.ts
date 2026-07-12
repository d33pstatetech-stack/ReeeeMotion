import { describe, it, expect, beforeEach } from "vitest";
import {
  RECENT_PROJECTS_KEY,
  MAX_RECENT,
  pushRecent,
  removeRecent,
  readRecents,
  writeRecents,
} from "./useRecentProjects";

describe("pushRecent / removeRecent (pure)", () => {
  it("ignores empty / whitespace-only names", () => {
    expect(pushRecent([], "")).toEqual([]);
    expect(pushRecent(["a"], "   ")).toEqual(["a"]);
  });

  it("trims before storing", () => {
    expect(pushRecent([], "  hello  ")).toEqual(["hello"]);
  });

  it("dedupes and moves to front", () => {
    expect(pushRecent(["foo", "bar"], "foo")).toEqual(["foo", "bar"]);
    expect(pushRecent(["foo", "bar"], "bar")).toEqual(["bar", "foo"]);
    expect(pushRecent(["foo", "bar"], "baz")).toEqual(["baz", "foo", "bar"]);
  });

  it("caps to MAX_RECENT (oldest dropped)", () => {
    let list: string[] = [];
    for (const n of ["a", "b", "c", "d", "e", "f", "g"]) {
      list = pushRecent(list, n);
    }
    expect(list).toHaveLength(MAX_RECENT);
    expect(list).toEqual(["g", "f", "e", "d", "c"]);
  });

  it("removeRecent deletes a single entry by exact name", () => {
    expect(removeRecent(["c", "b", "a"], "b")).toEqual(["c", "a"]);
    expect(removeRecent(["a"], "missing")).toEqual(["a"]);
  });
});

describe("readRecents / writeRecents (storage)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty array when nothing is persisted", () => {
    expect(readRecents()).toEqual([]);
  });

  it("roundtrips a written list", () => {
    writeRecents(["alpha", "beta"]);
    expect(readRecents()).toEqual(["alpha", "beta"]);
  });

  it("ignores garbage payloads", () => {
    localStorage.setItem(RECENT_PROJECTS_KEY, "not json{{{");
    expect(readRecents()).toEqual([]);
  });

  it("filters non-string / blank entries", () => {
    localStorage.setItem(
      RECENT_PROJECTS_KEY,
      JSON.stringify(["ok", 42, "", "   ", null, "also-ok"]),
    );
    expect(readRecents()).toEqual(["ok", "also-ok"]);
  });

  it("truncates persisted lists to MAX_RECENT", () => {
    const huge = Array.from({ length: MAX_RECENT + 10 }, (_, i) => `n${i}`);
    writeRecents(huge);
    expect(readRecents()).toHaveLength(MAX_RECENT);
  });

  it("uses the documented storage key", () => {
    writeRecents(["a"]);
    expect(localStorage.getItem(RECENT_PROJECTS_KEY)).not.toBeNull();
  });
});
