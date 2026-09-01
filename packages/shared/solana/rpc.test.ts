import { afterEach, describe, it, expect, vi } from "vitest";
import { quoteUnsafeIntegers, solanaRpc } from "./rpc.js";

afterEach(() => vi.unstubAllGlobals());

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

  it("leaves a float whose fraction exceeds MAX_SAFE_INTEGER intact", () => {
    // 0.1 + 0.2 needs 17 significant digits, so the fractional run on its own
    // is larger than MAX_SAFE_INTEGER. Scanning only the integer part would
    // restart at the ".", quote the fraction, and emit `0."30000000000000004"`.
    expect(roundTrip('{"uiAmount":0.30000000000000004}')).toEqual({
      uiAmount: 0.30000000000000004,
    });
    expect(
      roundTrip('{"a":0.12345678901234568,"b":-0.30000000000000004}'),
    ).toEqual({ a: 0.12345678901234568, b: -0.30000000000000004 });
  });

  it("consumes exponents rather than quoting their digits", () => {
    expect(
      roundTrip('{"a":1e21,"b":1E+21,"c":9.5e-8,"d":-1.5e-9}'),
    ).toEqual({ a: 1e21, b: 1e21, c: 9.5e-8, d: -1.5e-9 });
  });

  it("still quotes large integers sitting next to floats", () => {
    expect(
      roundTrip('{"ui":0.30000000000000004,"amount":18446744073709551615}'),
    ).toEqual({
      ui: 0.30000000000000004,
      amount: "18446744073709551615",
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

describe("solanaRpc", () => {
  it("refuses HTTP redirects from the exact configured endpoint", async () => {
    const fetcher = vi.fn(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      expect(init?.redirect).toBe("error");
      return new Response('{"jsonrpc":"2.0","result":{"ok":true},"id":1}');
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(solanaRpc("https://rpc.example", "getHealth")).resolves.toEqual({
      ok: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
