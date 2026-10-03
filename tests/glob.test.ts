import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { matchGlob } from "../src/core/utils/glob.js";

describe("matchGlob utility", () => {
  it("matches single wildcards and globstars correctly", () => {
    assert.equal(matchGlob("src/**/temp_*", "src/auth/temp_foo.ts"), true);
    assert.equal(matchGlob("src/**/temp_*", "src/temp_foo.ts"), true);
    assert.equal(
      matchGlob("src/**/temp_*", "src/nested/deep/temp_test.js"),
      true,
    );
    assert.equal(matchGlob("src/**/temp_*", "src/auth/valid.ts"), false);
    assert.equal(matchGlob("src/**/legacy_*", "src/legacy_old.ts"), true);
    assert.equal(
      matchGlob("src/**/legacy_*", "src/billing/legacy_v1.ts"),
      true,
    );
    assert.equal(matchGlob("src/**/legacy_*", "src/billing/v2.ts"), false);
  });
});
