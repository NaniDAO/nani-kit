import { describe, it, expect, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { parseFlags } from "./utils/flags.js";
import { scrubSecrets } from "./utils/output.js";

const CLI = resolve(__dirname, "dist/index.mjs");

/**
 * Subprocess timeout — CLI init loads 150+ tools (~2-3s), plus the RPC call
 * itself. 60s is generous enough for flaky public RPCs.
 */
const SUBPROCESS_TIMEOUT = 60_000;

/** Vitest per-test timeout — must exceed SUBPROCESS_TIMEOUT. */
const TEST_TIMEOUT = 90_000;

/** Timeout for config tests that spawn 2-3 subprocesses (~3s each). */
const CONFIG_TEST_TIMEOUT = 30_000;

/** Run the CLI with given args and optional env overrides. */
function run(
  args: string[],
  env?: Record<string, string>,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    execFile(
      "node",
      [CLI, ...args],
      {
        timeout: SUBPROCESS_TIMEOUT,
        env: { ...process.env, ...env },
      },
      (err, stdout, stderr) => {
        const exitCode = err && "code" in err ? (err as any).code as number : 0;
        resolve({ stdout, stderr, exitCode });
      },
    );
  });
}

/** Parse stdout as JSON, failing the test if it's not valid JSON. */
function parseJson(stdout: string): any {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Expected valid JSON, got:\n${stdout}`);
  }
}

describe("CLI — local input hardening", () => {
  it("ignores prototype-mutating keys in --json", () => {
    const result = parseFlags(
      [
        "--json",
        '{"safe":"ok","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true}}',
      ],
      z.object({}),
    );

    expect(result).toEqual({ safe: "ok" });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as any).polluted).toBeUndefined();
  });

  it("scrubs configured secrets and the config directory from errors", () => {
    const previousKey = process.env.PERPLEXITY_API_KEY;
    const previousDir = process.env.AGENTEK_CONFIG_DIR;
    process.env.PERPLEXITY_API_KEY = "pplx-sensitive-test-value";
    process.env.AGENTEK_CONFIG_DIR = "/tmp/private-agentek-config";
    try {
      expect(
        scrubSecrets(
          "failed with pplx-sensitive-test-value at /tmp/private-agentek-config/config.json",
        ),
      ).toBe("failed with [REDACTED:PERPLEXITY_API_KEY] at [CONFIG_DIR]/config.json");
    } finally {
      if (previousKey === undefined) delete process.env.PERPLEXITY_API_KEY;
      else process.env.PERPLEXITY_API_KEY = previousKey;
      if (previousDir === undefined) delete process.env.AGENTEK_CONFIG_DIR;
      else process.env.AGENTEK_CONFIG_DIR = previousDir;
    }
  });
});

// ── Usage / help ─────────────────────────────────────────────────────────

describe("CLI — usage & help", () => {
  it("no args should print usage to stderr and exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Usage:");
    expect(stderr).toContain("agentek list");
    expect(stdout).toBe("");
  });

  it("help should print usage to stderr and exit 2", async () => {
    const { stderr, exitCode } = await run(["help"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Usage:");
  });

  it("--help should print usage to stderr and exit 2", async () => {
    const { stderr, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Usage:");
  });

  it("unknown command should print usage to stderr and exit 2", async () => {
    const { stderr, exitCode } = await run(["bogus"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Usage:");
  });
});

// ── version ──────────────────────────────────────────────────────────────

describe("CLI — version", () => {
  it("--version should print version to stdout and exit 0", async () => {
    const { stdout, exitCode } = await run(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("-v should print version to stdout and exit 0", async () => {
    const { stdout, exitCode } = await run(["-v"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ── config ───────────────────────────────────────────────────────────────

describe("CLI — config", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentek-test-"));
  });

  const cfgEnv = () => ({ AGENTEK_CONFIG_DIR: tmpDir });

  it("config set should persist a key", async () => {
    const { stdout, exitCode } = await run(
      ["config", "set", "PERPLEXITY_API_KEY", "pplx-test-1234567890"],
      cfgEnv(),
    );
    expect(exitCode).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    expect(result.key).toBe("PERPLEXITY_API_KEY");
  }, CONFIG_TEST_TIMEOUT);

  it("config get should return redacted value by default", async () => {
    await run(["config", "set", "PERPLEXITY_API_KEY", "pplx-test-1234567890"], cfgEnv());
    const { stdout, exitCode } = await run(
      ["config", "get", "PERPLEXITY_API_KEY"],
      cfgEnv(),
    );
    expect(exitCode).toBe(0);
    const result = parseJson(stdout);
    expect(result.key).toBe("PERPLEXITY_API_KEY");
    expect(result.value).toContain("...");
    expect(result.value).not.toBe("pplx-test-1234567890");
  }, CONFIG_TEST_TIMEOUT);

  it("config get --reveal should return full value", async () => {
    await run(["config", "set", "PERPLEXITY_API_KEY", "pplx-test-1234567890"], cfgEnv());
    const { stdout, exitCode } = await run(
      ["config", "get", "PERPLEXITY_API_KEY", "--reveal"],
      cfgEnv(),
    );
    expect(exitCode).toBe(0);
    const result = parseJson(stdout);
    expect(result.value).toBe("pplx-test-1234567890");
  }, CONFIG_TEST_TIMEOUT);

  it("config list should show all known keys", async () => {
    await run(["config", "set", "PERPLEXITY_API_KEY", "pplx-test-1234567890"], cfgEnv());
    const { stdout, exitCode } = await run(["config", "list"], cfgEnv());
    expect(exitCode).toBe(0);
    const list = parseJson(stdout);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(14);
    const pplx = list.find((k: any) => k.key === "PERPLEXITY_API_KEY");
    expect(pplx.status).toBe("configured");
    expect(pplx.source).toBe("config");
  }, CONFIG_TEST_TIMEOUT);

  it("config delete should remove a key", async () => {
    await run(["config", "set", "ZEROX_API_KEY", "zrx-test-123"], cfgEnv());
    const { stdout, exitCode } = await run(
      ["config", "delete", "ZEROX_API_KEY"],
      cfgEnv(),
    );
    expect(exitCode).toBe(0);
    const result = parseJson(stdout);
    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(true);

    // Verify it's gone
    const { stdout: getOut } = await run(["config", "get", "ZEROX_API_KEY"], cfgEnv());
    expect(parseJson(getOut).value).toBeNull();
  }, CONFIG_TEST_TIMEOUT);

  it("config delete of missing key should report deleted: false", async () => {
    const { stdout, exitCode } = await run(
      ["config", "delete", "ZEROX_API_KEY"],
      cfgEnv(),
    );
    expect(exitCode).toBe(0);
    const result = parseJson(stdout);
    expect(result.deleted).toBe(false);
  }, CONFIG_TEST_TIMEOUT);

  it("config set should warn for unknown key", async () => {
    const { stderr, exitCode } = await run(
      ["config", "set", "UNKNOWN_KEY_XYZ", "value"],
      cfgEnv(),
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("not a known key");
  }, CONFIG_TEST_TIMEOUT);
});

// ── setup ────────────────────────────────────────────────────────────────

describe("CLI — setup", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentek-test-"));
  });

  it("should show key status to stderr", async () => {
    const { stderr, exitCode } = await run(["setup"], { AGENTEK_CONFIG_DIR: tmpDir });
    expect(exitCode).toBe(0);
    expect(stderr).toContain("PERPLEXITY_API_KEY");
    expect(stderr).toContain("PRIVATE_KEY");
    expect(stderr).toContain("keys configured");
  }, CONFIG_TEST_TIMEOUT);

  it("should detect configured keys from config file", async () => {
    await run(
      ["config", "set", "PERPLEXITY_API_KEY", "pplx-test-1234567890"],
      { AGENTEK_CONFIG_DIR: tmpDir },
    );
    const { stderr, exitCode } = await run(["setup"], { AGENTEK_CONFIG_DIR: tmpDir });
    expect(exitCode).toBe(0);
    expect(stderr).toContain("configured");
    expect(stderr).toContain("1/14");
  }, CONFIG_TEST_TIMEOUT);
});

// ── env overrides config ─────────────────────────────────────────────────

describe("CLI — env overrides config", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentek-test-"));
  });

  it("env var should take precedence over config file value", async () => {
    // Set config value
    await run(
      ["config", "set", "PERPLEXITY_API_KEY", "from-config-file-value"],
      { AGENTEK_CONFIG_DIR: tmpDir },
    );

    // config list with env var set should show env as source
    const { stdout } = await run(["config", "list"], {
      AGENTEK_CONFIG_DIR: tmpDir,
      PERPLEXITY_API_KEY: "from-env-variable-value",
    });
    const list = parseJson(stdout);
    const pplx = list.find((k: any) => k.key === "PERPLEXITY_API_KEY");
    expect(pplx.source).toBe("env");
    expect(pplx.status).toBe("configured");
  }, CONFIG_TEST_TIMEOUT);
});

// ── search ───────────────────────────────────────────────────────────────

describe("CLI — search", () => {
  it("should return matching tools by name", async () => {
    const { stdout, exitCode } = await run(["search", "balance"]);
    expect(exitCode).toBe(0);

    const matches = parseJson(stdout);
    expect(Array.isArray(matches)).toBe(true);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toHaveProperty("name");
    expect(matches[0]).toHaveProperty("description");
    const names = matches.map((m: any) => m.name);
    expect(names).toContain("getBalance");
  }, TEST_TIMEOUT);

  it("should return matching tools by description", async () => {
    const { stdout, exitCode } = await run(["search", "block number"]);
    expect(exitCode).toBe(0);

    const matches = parseJson(stdout);
    expect(matches.length).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it("should be case-insensitive", async () => {
    const { stdout: lower } = await run(["search", "ens"]);
    const { stdout: upper } = await run(["search", "ENS"]);
    expect(parseJson(lower).length).toBe(parseJson(upper).length);
  }, CONFIG_TEST_TIMEOUT);

  it("should return empty array for no matches", async () => {
    const { stdout, exitCode } = await run(["search", "xyznonexistent999"]);
    expect(exitCode).toBe(0);
    expect(parseJson(stdout)).toEqual([]);
  }, TEST_TIMEOUT);

  it("should error when no keyword is given", async () => {
    const { stderr, exitCode } = await run(["search"]);
    expect(exitCode).toBe(1);
    const err = parseJson(stderr);
    expect(err.error).toContain("Usage");
  }, TEST_TIMEOUT);
});

// ── list ──────────────────────────────────────────────────────────────────

describe("CLI — list", () => {
  it("should return a sorted JSON array of tool names", async () => {
    const { stdout, exitCode } = await run(["list"]);
    expect(exitCode).toBe(0);

    const names = parseJson(stdout);
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(100);

    // Verify sorted
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);

    // Spot-check well-known tools
    expect(names).toContain("getBlockNumber");
    expect(names).toContain("getBalance");
    expect(names).toContain("resolveENS");
  }, TEST_TIMEOUT);
});

// ── info ──────────────────────────────────────────────────────────────────

describe("CLI — info", () => {
  it("should return tool info with schema for a known tool", async () => {
    const { stdout, exitCode } = await run(["info", "getBlockNumber"]);
    expect(exitCode).toBe(0);

    const info = parseJson(stdout);
    expect(info.name).toBe("getBlockNumber");
    expect(typeof info.description).toBe("string");
    expect(info.description.length).toBeGreaterThan(0);
    expect(info.parameters).toBeDefined();
    expect(info.parameters.type).toBe("object");
    expect(info.parameters.properties).toHaveProperty("chainId");
    expect(Array.isArray(info.supportedChains)).toBe(true);
    expect(info.supportedChains.length).toBeGreaterThan(0);
    expect(info.supportedChains[0]).toHaveProperty("id");
    expect(info.supportedChains[0]).toHaveProperty("name");
  }, TEST_TIMEOUT);

  it("should error for unknown tool", async () => {
    const { stderr, exitCode } = await run(["info", "nonExistentTool"]);
    expect(exitCode).toBe(1);

    const err = parseJson(stderr);
    expect(err.error).toContain("Unknown tool");
  }, TEST_TIMEOUT);

  it("should suggest closest match for typos", async () => {
    const { stderr, exitCode } = await run(["info", "getbalance"]);
    expect(exitCode).toBe(1);

    const err = parseJson(stderr);
    expect(err.code).toBe("UNKNOWN_TOOL");
    expect(err.hint).toContain("Did you mean");
    expect(err.hint).toContain("getBalance");
  }, TEST_TIMEOUT);

  it("should error when no tool name is given", async () => {
    const { stderr, exitCode } = await run(["info"]);
    expect(exitCode).toBe(1);

    const err = parseJson(stderr);
    expect(err.error).toContain("Usage");
  }, TEST_TIMEOUT);
});

// ── exec ──────────────────────────────────────────────────────────────────

describe("CLI — exec", () => {
  it("should execute getBlockNumber on Base with --key value syntax", async () => {
    const { stdout, exitCode } = await run(["exec", "getBlockNumber", "--chainId", "8453"]);
    expect(exitCode).toBe(0);

    const result = parseJson(stdout);
    // chainId is coerced from string "8453" → number 8453 via Zod schema
    expect(result.chainId).toBe(8453);
    expect(typeof result.blockNumber).toBe("string");
    expect(Number(result.blockNumber)).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it("should support --key=value syntax", async () => {
    const { stdout, exitCode } = await run(["exec", "getBlockNumber", "--chainId=8453"]);
    expect(exitCode).toBe(0);

    const result = parseJson(stdout);
    expect(result.chainId).toBe(8453);
    expect(Number(result.blockNumber)).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it("should error for unknown tool", async () => {
    const { stderr, exitCode } = await run(["exec", "invalidTool", "--foo", "bar"]);
    expect(exitCode).toBe(1);

    const err = parseJson(stderr);
    expect(err.error).toContain("Unknown tool");
  }, TEST_TIMEOUT);

  it("should error when no tool name is given", async () => {
    const { stderr, exitCode } = await run(["exec"]);
    expect(exitCode).toBe(1);

    const err = parseJson(stderr);
    expect(err.error).toContain("Usage");
  }, TEST_TIMEOUT);

  it("should support --timeout flag", async () => {
    const { stdout, exitCode } = await run([
      "exec", "getBlockNumber", "--chainId", "8453", "--timeout", "60000",
    ]);
    expect(exitCode).toBe(0);
    const result = parseJson(stdout);
    expect(result.chainId).toBe(8453);
  }, TEST_TIMEOUT);

  it("should error with invalid --timeout value", async () => {
    const { stderr, exitCode } = await run([
      "exec", "getBlockNumber", "--chainId", "8453", "--timeout", "abc",
    ]);
    expect(exitCode).toBe(1);
    const err = parseJson(stderr);
    expect(err.error).toContain("--timeout");
  }, TEST_TIMEOUT);
});

// ── structured errors ─────────────────────────────────────────────────────

describe("CLI — structured errors", () => {
  it("missing required param should return VALIDATION_ERROR with hint", async () => {
    // getBalance requires `address` — omitting it should trigger a Zod validation error
    const { stderr, exitCode } = await run(["exec", "getBalance"]);
    expect(exitCode).toBe(1);

    const err = parseJson(stderr);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.error).toContain("address");
    expect(err.hint).toContain("agentek info getBalance");
    expect(err.retryable).toBe(true);
  }, TEST_TIMEOUT);

  it("unsupported chain should return CHAIN_NOT_SUPPORTED with chain list hint", async () => {
    // chainId 999999 is not configured — should produce a chain-not-supported error
    const { stderr, exitCode } = await run([
      "exec", "getBlockNumber", "--chainId", "999999",
    ]);
    expect(exitCode).toBe(1);

    const err = parseJson(stderr);
    expect(err.code).toBe("CHAIN_NOT_SUPPORTED");
    expect(err.hint).toContain("Supported chains:");
    expect(err.retryable).toBe(true);
  }, TEST_TIMEOUT);

  it("key-gated tool without key should return MISSING_API_KEY with config set hint", async () => {
    const { stderr, exitCode } = await run(["exec", "askPerplexitySearch", "--query", "test"]);
    expect(exitCode).toBe(1);

    const err = parseJson(stderr);
    expect(err.code).toBe("MISSING_API_KEY");
    expect(err.error).toContain("PERPLEXITY_API_KEY");
    expect(err.hint).toContain("config set");
    expect(err.retryable).toBe(true);
  }, TEST_TIMEOUT);
});
