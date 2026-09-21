import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, canonicalize, snapshotHash } from "@/lib/travel/snapshots";

describe("canonicalize", () => {
  it("produces identical output regardless of key insertion order", () => {
    const a = { b: 2, a: { d: "4", c: 3 }, list: [1, { y: 1, x: 2 }] };
    const b = { list: [1, { x: 2, y: 1 }], a: { c: 3, d: "4" }, b: 2 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"a":{"c":3,"d":"4"},"b":2,"list":[1,{"x":2,"y":1}]}');
  });

  it("keeps decimal-string money as strings (no numeric degradation)", () => {
    expect(canonicalize({ cost: "1864.00" })).toBe('{"cost":"1864.00"}');
  });
});

describe("snapshotHash", () => {
  it("same content in different key order → identical hash", () => {
    const a = { engineVersion: ENGINE_VERSION, fx: { rates: { USD: "365" }, quoteCurrency: "USD" }, policy: { rate: "0.14" } };
    const b = { policy: { rate: "0.14" }, fx: { quoteCurrency: "USD", rates: { USD: "365" } }, engineVersion: ENGINE_VERSION };
    expect(snapshotHash(a)).toBe(snapshotHash(b));
    expect(snapshotHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("any change → different hash", () => {
    const base = { engineVersion: ENGINE_VERSION, policy: { rate: "0.14" } };
    expect(snapshotHash(base)).not.toBe(snapshotHash({ ...base, policy: { rate: "0.15" } }));
    expect(snapshotHash(base)).not.toBe(snapshotHash({ ...base, engineVersion: "9.9.9" }));
  });
});
