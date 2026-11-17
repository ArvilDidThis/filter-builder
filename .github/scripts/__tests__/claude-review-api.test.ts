import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

const SCRIPT_PATH = resolve(import.meta.dirname, "../claude-review-api.sh");
const MOCK_GH_PATH = resolve(import.meta.dirname, "mock-gh.sh");
const REPO = "owner/repo";
const PR = "42";
const ISSUE_URL = `https://api.github.com/repos/${REPO}/issues/${PR}`;

let tmpDir: string;
let logPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "claude-review-api-"));
  logPath = join(tmpDir, "gh-calls.jsonl");
  // Put the mock first on PATH under the name "gh"
  chmodSync(MOCK_GH_PATH, 0o755);
  symlinkSync(MOCK_GH_PATH, join(tmpDir, "gh"));
});

afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

/** Runs the script with the mocked gh; `env` overrides the default repository and PR. */
function run(
  args: string[],
  opts: { stdin?: string; env?: Record<string, string> } = {},
) {
  const result = spawnSync("bash", [SCRIPT_PATH, ...args], {
    env: {
      ...process.env,
      PATH: `${tmpDir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: REPO,
      PR_NUMBER: PR,
      MOCK_GH_LOG: logPath,
      ...opts.env,
    },
    input: opts.stdin ?? "",
    encoding: "utf8",
    timeout: 10_000,
  });
  return { code: result.status, stderr: result.stderr };
}

/** Every gh call the script made, as argument lists. */
const ghCalls = (): string[][] =>
  existsSync(logPath)
    ? readFileSync(logPath, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as string[])
    : [];

describe("claude-review-api.sh allowed calls", () => {
  test("comments and review-comments read every page of this PR only", () => {
    assert.equal(run(["comments"]).code, 0);
    assert.equal(run(["review-comments"]).code, 0);
    assert.deepEqual(ghCalls(), [
      ["api", `repos/${REPO}/issues/${PR}/comments?per_page=100`, "--paginate"],
      ["api", `repos/${REPO}/pulls/${PR}/comments?per_page=100`, "--paginate"],
    ]);
  });

  test("commit looks up a SHA with a read-only call", () => {
    assert.equal(run(["commit", "abc1234"]).code, 0);
    assert.deepEqual(ghCalls(), [
      ["api", `repos/${REPO}/commits/abc1234`, "--jq", ".sha"],
    ]);
  });

  test("post-comment posts stdin as a comment on this PR", () => {
    assert.equal(run(["post-comment"], { stdin: "hello" }).code, 0);
    assert.deepEqual(ghCalls(), [
      [
        "api",
        `repos/${REPO}/issues/${PR}/comments`,
        "-X",
        "POST",
        "-f",
        "body=hello",
        "--jq",
        ".id",
      ],
    ]);
  });

  test("reply answers an inline comment on this PR", () => {
    assert.equal(run(["reply", "7"], { stdin: "thanks" }).code, 0);
    assert.deepEqual(ghCalls(), [
      [
        "api",
        `repos/${REPO}/pulls/${PR}/comments/7/replies`,
        "-X",
        "POST",
        "-f",
        "body=thanks",
        "--jq",
        ".id",
      ],
    ]);
  });

  test("edit-comment edits the reviewer's own comment on this PR", () => {
    const env = { MOCK_GH_RESPONSE: `github-actions[bot]\\t${ISSUE_URL}` };
    assert.equal(run(["edit-comment", "9"], { stdin: "new", env }).code, 0);
    assert.deepEqual(ghCalls().at(-1), [
      "api",
      `repos/${REPO}/issues/comments/9`,
      "-X",
      "PATCH",
      "-f",
      "body=new",
      "--jq",
      ".id",
    ]);
  });
});

describe("claude-review-api.sh refused calls", () => {
  /** Asserts the script failed without making any write call (a call with -X). */
  const assertRefused = (result: { code: number | null }) => {
    assert.notEqual(result.code, 0);
    assert.ok(
      ghCalls().every((call) => !call.includes("-X")),
      "no write call was made",
    );
  };

  test("edit-comment refuses someone else's comment", () => {
    const env = { MOCK_GH_RESPONSE: `some-human\\t${ISSUE_URL}` };
    assertRefused(run(["edit-comment", "9"], { stdin: "new", env }));
  });

  test("edit-comment refuses a comment on another PR", () => {
    const env = { MOCK_GH_RESPONSE: `github-actions[bot]\\t${ISSUE_URL}0` };
    assertRefused(run(["edit-comment", "9"], { stdin: "new", env }));
  });

  test("unknown subcommands and raw endpoints are refused", () => {
    assertRefused(run(["repos/owner/repo/git/refs/heads/main"]));
    assertRefused(run(["delete-comment", "9"]));
    assert.deepEqual(ghCalls(), []);
  });

  test("malformed IDs and SHAs are refused", () => {
    assertRefused(run(["reply", "7/../../../git/refs"], { stdin: "x" }));
    assertRefused(run(["commit", "main"]));
    assert.deepEqual(ghCalls(), []);
  });

  test("an empty body is refused", () => {
    assertRefused(run(["post-comment"], { stdin: "  \n" }));
    assert.deepEqual(ghCalls(), []);
  });

  test("a missing or malformed PR number is refused", () => {
    assertRefused(run(["comments"], { env: { PR_NUMBER: "" } }));
    assertRefused(run(["comments"], { env: { PR_NUMBER: "42/../43" } }));
    assert.deepEqual(ghCalls(), []);
  });
});
