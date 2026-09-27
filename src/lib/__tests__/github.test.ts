import { describe, expect, it } from "vitest";
import { extractIssueKeys, parseRepo, parseRepoList } from "../github/keys";

describe("extractIssueKeys", () => {
  it("finds known keys in branches, titles and messages, case-insensitively, once each", () => {
    const keys = extractIssueKeys("feat/plat-12-audit-log: PLAT-12 fixes BILL-3 and plat-12 again; ignore ABC-9 and SHA-256", ["PLAT", "BILL"]);
    expect(keys).toEqual([
      { key: "PLAT", seq: 12 },
      { key: "BILL", seq: 3 },
    ]);
  });
  it("does not match inside longer tokens", () => {
    expect(extractIssueKeys("XPLAT-12 PLAT-12a", ["PLAT"])).toEqual([]);
  });
});

describe("parseRepo", () => {
  it("accepts owner/name and GitHub URLs", () => {
    expect(parseRepo("ElAmir-Mansour/keel")).toEqual({ owner: "ElAmir-Mansour", name: "keel" });
    expect(parseRepo("https://github.com/ElAmir-Mansour/keel.git")).toEqual({ owner: "ElAmir-Mansour", name: "keel" });
    expect(parseRepo("nonsense")).toBeNull();
    expect(parseRepoList("a/b, c/d\nbad")).toHaveLength(2);
  });
});
