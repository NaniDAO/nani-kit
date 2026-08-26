import { describe, it, expect } from "vitest";
import { quoteUnsafeIntegers } from "./rpc.js";

describe("quoteUnsafeIntegers", () => {
  const roundTrip = (json: string) => JSON.parse(quoteUnsafeIntegers(json));

  it("preserves u64 values that JSON.parse would round", () => {
    // rentEpoch is u64::MAX for rent-exempt accounts.
    expect(roundTrip('{"rentEpoch":18446744073709551615}')).toEqual({
      rentEpoch: "18446744073709551615",
    });
    expect(roundTrip('{"lamports":9007199254740993}')).toEqual({
      lamports: "9007199254740993",
    });
  });

  it("leaves safe integers as numbers", () => {
    expect(roundTrip('{"slot":312345678,"decimals":6,"space":0}')).toEqual({
      slot: 312345678,
      decimals: 6,
      space: 0,
    });
    // Exactly MAX_SAFE_INTEGER is still exact.
    expect(roundTrip('{"n":9007199254740991}')).toEqual({ n: 9007199254740991 });
  });

  it("leaves floats and exponents alone", () => {
    expect(roundTrip('{"uiAmount":1234.56789,"e":1e21}')).toEqual({
      uiAmount: 1234.56789,
      e: 1e21,
    });
  });

  it("does not touch digits inside strings, including escapes", () => {
    const json = '{"logs":["Program log: 99999999999999999999",  "quote \\" 18446744073709551615"]}';
    expect(roundTrip(json)).toEqual({
      logs: [
        "Program log: 99999999999999999999",
        'quote " 18446744073709551615',
      ],
    });
  });

  it("keeps the sign attached on large negative numbers", () => {
    expect(roundTrip('{"n":-18446744073709551615}')).toEqual({
      n: "-18446744073709551615",
    });
  });

  it("handles arrays of mixed magnitudes", () => {
    expect(roundTrip('[1,18446744073709551615,3]')).toEqual([
      1,
      "18446744073709551615",
      3,
    ]);
  });
});
