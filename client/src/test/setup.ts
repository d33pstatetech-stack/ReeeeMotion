/**
 * Vitest global setup.
 *
 * The browser-only APIs our utils touch (URL.createObjectURL, ResizeObserver,
 * crypto.randomUUID) need polyfills for jsdom. We provide them here so each
 * test file can just `import` whatever it needs without per-test stubs.
 *
 * Note: we use `Object.defineProperty` to install the polyfills because both
 * `URL.createObjectURL` (DOM lib type) and `globalThis.crypto.randomUUID`
 * are typed as returning a UUID-template literal `${string}-${string}-...`
 * — overriding them through a plain assignment requires a widening cast.
 * The `defineProperty` route side-steps this because the `value` field can
 * be typed as the method's actual return shape.
 */

import { afterEach, beforeEach, vi } from "vitest";

// ResizeObserver is referenced by Radix but not in jsdom. Provide a noop stub.
if (typeof (globalThis as any).ResizeObserver !== "function") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// JSDOM does not implement URL.createObjectURL — stub it for downloadBlob tests.
if (typeof URL.createObjectURL === "undefined") {
  Object.defineProperty(URL, "createObjectURL", {
    writable: true,
    value: vi.fn(
      () => "blob:mock-url-" + Math.random().toString(36),
    ) as unknown as typeof URL.createObjectURL,
  });
}
if (typeof URL.revokeObjectURL === "undefined") {
  Object.defineProperty(URL, "revokeObjectURL", {
    writable: true,
    value: vi.fn() as unknown as typeof URL.revokeObjectURL,
  });
}

// crypto.randomUUID is in Node 19+, but jsdom's `crypto` shape types it as
// returning a UUID-template literal. Our stub returns a simpler string, so
// we install via defineProperty + cast once.
if (typeof globalThis.crypto === "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    writable: true,
    value: {} as Crypto,
  });
}
if (typeof globalThis.crypto.randomUUID === "undefined") {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    writable: true,
    value: vi.fn(
      () =>
        "test-" +
        Math.random().toString(36).slice(2) +
        "-" +
        Date.now().toString(36),
    ) as unknown as Crypto["randomUUID"],
  });
}

// Each test starts with a clean localStorage so persist migration tests are
// deterministic.
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore in non-browser-like envs */
  }
});

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
