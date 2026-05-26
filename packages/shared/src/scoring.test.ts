import assert from "node:assert/strict";
import {
  createPartySchema,
  defaultPartySettings,
  normalizeRanking,
  putTrackInTopThree,
  scoreBallots,
  type Ballot,
  type Track,
} from "./index.js";

const tracks = [
  makeTrack("a", "No Static", 1),
  makeTrack("b", "Green Room", 2),
  makeTrack("c", "Late Entry", 3),
  makeTrack("d", "Deep Cut", 4),
];

const ballots: Ballot[] = [
  { participantId: "p1", submittedAt: new Date().toISOString(), ranks: normalizeRanking(["b", "a", "c"]) },
  { participantId: "p2", submittedAt: new Date().toISOString(), ranks: normalizeRanking(["a", "b", "c"]) },
  { participantId: "p3", submittedAt: new Date().toISOString(), ranks: normalizeRanking(["b", "c", "a"]) },
];

assert.deepEqual(putTrackInTopThree(["a", "b", "c"], "d"), ["d", "a", "b"]);
assert.deepEqual(putTrackInTopThree(["a", "b", "c"], "b"), ["b", "a", "c"]);
assert.deepEqual(normalizeRanking(["a", "a", "b", "c", "d"]), [
  { trackId: "a", rank: 1 },
  { trackId: "b", rank: 2 },
  { trackId: "c", rank: 3 },
]);

const [winner] = scoreBallots(tracks, ballots);
assert.equal(winner.trackId, "b");
assert.equal(winner.score, 13);
assert.equal(winner.firstPlaceVotes, 2);
assert.equal(defaultPartySettings().maxDurationMinutes, 45);
assert.equal(
  createPartySchema.parse({
    title: "Nero afterhours",
    hostName: "Host",
    settings: { maxDurationMinutes: 30, allowUploads: false, allowSpotify: true },
  }).settings?.maxDurationMinutes,
  30,
);
assert.throws(() =>
  createPartySchema.parse({
    title: "Nero afterhours",
    hostName: "Host",
    settings: { allowAudius: false, allowUploads: false, allowSpotify: false },
  }),
);

console.log("shared scoring tests passed");

function makeTrack(id: string, title: string, queuePosition: number): Track {
  return {
    id,
    partyId: "party",
    sourceType: "upload",
    sourceId: id,
    title,
    artist: "Mina Vale",
    artworkUrl: null,
    streamUrl: `https://example.com/${id}.mp3`,
    durationSeconds: 180,
    queuePosition,
    submittedByParticipantId: "host",
    submittedByName: "Host",
    status: "played",
    createdAt: new Date().toISOString(),
  };
}
