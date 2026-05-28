import assert from "node:assert/strict";
import {
  createPartySchema,
  defaultPartySettings,
  normalizeRating,
  ratingToTenths,
  scoreRatings,
  tenthsToRating,
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
  { participantId: "p1", submittedAt: new Date().toISOString(), ratings: [{ trackId: "b", rating: 4.9 }, { trackId: "a", rating: 3.1 }] },
  { participantId: "p2", submittedAt: new Date().toISOString(), ratings: [{ trackId: "a", rating: 4.8 }, { trackId: "b", rating: 4.2 }] },
  { participantId: "p3", submittedAt: new Date().toISOString(), ratings: [{ trackId: "b", rating: 5 }, { trackId: "c", rating: 0 }] },
];

assert.equal(normalizeRating(4.24), 4.2);
assert.equal(normalizeRating(4.25), 4.3);
assert.equal(normalizeRating(7), 5);
assert.equal(ratingToTenths(4.26), 43);
assert.equal(tenthsToRating(41), 4.1);

const [winner] = scoreRatings(tracks, ballots);
assert.equal(winner.trackId, "b");
assert.equal(winner.score, 4.7);
assert.equal(winner.ratingCount, 3);
assert.equal(winner.explicitRatingCount, 3);
assert.equal(winner.defaultRatingCount, 0);
assert.equal(winner.totalRating, 14.1);
assert.equal(winner.firstPlaceVotes, 1);
const cResult = scoreRatings(tracks, ballots, { eligibleVoterCount: 3 }).find((result) => result.trackId === "c");
assert.equal(cResult?.score, 2);
assert.equal(cResult?.explicitRatingCount, 1);
assert.equal(cResult?.defaultRatingCount, 2);
assert.equal(cResult?.totalRating, 6);
const unratedResult = scoreRatings(tracks, ballots, { eligibleVoterCount: 3 }).find((result) => result.trackId === "d");
assert.equal(unratedResult?.score, 3);
assert.equal(unratedResult?.explicitRatingCount, 0);
assert.equal(unratedResult?.defaultRatingCount, 3);
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
