/* global URL, console */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const domainSource = readFileSync(new URL("../src/types/domain.ts", import.meta.url), "utf8");

assert.match(
  domainSource,
  /export type StaffProfile = \{[\s\S]*?store_id: string \| null;/,
  "a profile may be returned without a store assignment"
);

assert.match(
  appSource,
  /if \(!profile \|\| !profile\.store_id \|\| profile\.store_id === "null"\)/,
  "an unassigned signed-in profile, including a literal null string, must be sent to the store connection screen"
);

console.log("profile-store-connection contract: passed");
