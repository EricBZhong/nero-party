import assert from "node:assert/strict";
import { isSupportedUploadMimeType, sanitizeUploadFileName } from "./index.js";

assert.equal(isSupportedUploadMimeType("audio/mpeg"), true);
assert.equal(isSupportedUploadMimeType("audio/wav"), true);
assert.equal(isSupportedUploadMimeType("video/mp4"), false);
assert.equal(sanitizeUploadFileName("nero party: final / mix"), "nero-party-final-mix");
assert.equal(sanitizeUploadFileName("  $$$  "), "");

console.log("player upload tests passed");
