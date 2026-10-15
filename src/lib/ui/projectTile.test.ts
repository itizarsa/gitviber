import assert from "node:assert/strict";
import { test } from "node:test";
import { tileHue, tileInitials } from "./projectTile.ts";

test("a tile's letters are letters and digits only, from the name's words", () => {
  assert.equal(tileInitials("billing-api"), "BA");
  assert.equal(tileInitials("insta_clone"), "IC");
  assert.equal(tileInitials("myRepo"), "MR");
  assert.equal(tileInitials("gitviber"), "GI");
  assert.equal(tileInitials(".claude"), "CL");
  assert.equal(tileInitials("v2.app"), "VA");
  assert.equal(tileInitials("x"), "X");
  assert.equal(tileInitials("...") , "?");
  assert.equal(tileInitials("日本"), "?");
});

test("a name keeps its hue", () => {
  assert.equal(tileHue("gitviber"), tileHue("gitviber"));
  assert.ok(tileHue("gitviber") >= 0 && tileHue("gitviber") < 360);
});
