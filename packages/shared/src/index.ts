import { z } from "zod";

export const partyStatuses = ["lobby", "live", "voting", "finalized"] as const;
export const partyModes = ["focus", "companion"] as const;
export const trackStatuses = ["queued", "playing", "played", "skipped"] as const;
export const trackSourceTypes = ["audius", "spotify", "upload", "youtube_embed"] as const;
export const participantRoles = ["host", "guest"] as const;
export const reactionTypes = ["lift", "pass", "rewind"] as const;

export type PartyStatus = (typeof partyStatuses)[number];
export type PartyMode = (typeof partyModes)[number];
export type TrackStatus = (typeof trackStatuses)[number];
export type TrackSourceType = (typeof trackSourceTypes)[number];
export type ParticipantRole = (typeof participantRoles)[number];
export type ReactionType = (typeof reactionTypes)[number];

export interface PartySettings {
  maxSubmissionsPerParticipant: number;
  maxQueueSize: number;
  maxDurationMinutes: number;
  votingLockSeconds: number;
  allowDiscordVoice: boolean;
  allowUploads: boolean;
  allowAudius: boolean;
  allowSpotify: boolean;
}

export interface User {
  id: string;
  displayName: string;
  discordId?: string | null;
}

export interface Participant {
  id: string;
  partyId: string;
  userId?: string | null;
  displayName: string;
  role: ParticipantRole;
  source: "web" | "discord" | "overlay";
  token: string;
  isPresent: boolean;
  audioReady: boolean;
  joinedAt: string;
}

export interface Track {
  id: string;
  partyId: string;
  sourceType: TrackSourceType;
  sourceId: string;
  title: string;
  artist: string;
  artworkUrl?: string | null;
  streamUrl?: string | null;
  durationSeconds: number;
  queuePosition: number;
  submittedByParticipantId: string;
  submittedByName: string;
  status: TrackStatus;
  createdAt: string;
}

export interface PlaybackState {
  partyId: string;
  currentTrackId?: string | null;
  startedAt?: string | null;
  pausedAt?: string | null;
  serverNow: string;
  positionSeconds: number;
  isPlaying: boolean;
}

export interface Reaction {
  id: string;
  partyId: string;
  participantId: string;
  trackId: string;
  type: ReactionType;
  createdAt: string;
}

export interface SavedTrack {
  id: string;
  participantId: string;
  trackId: string;
  createdAt: string;
}

export interface RankingEntry {
  participantId: string;
  trackId: string;
  rank: number;
}

export interface BallotRank {
  trackId: string;
  rank: number;
}

export interface Ballot {
  participantId: string;
  ranks: BallotRank[];
  submittedAt: string;
}

export interface WinnerResult {
  trackId: string;
  title: string;
  artist: string;
  submittedByName: string;
  score: number;
  firstPlaceVotes: number;
  appearances: number;
  queuePosition: number;
}

export interface PartyState {
  party: {
    id: string;
    code: string;
    title: string;
    mode: PartyMode;
    status: PartyStatus;
    settings: PartySettings;
    createdAt: string;
  };
  participants: Participant[];
  tracks: Track[];
  playback: PlaybackState;
  savedTracks: SavedTrack[];
  ranking: RankingEntry[];
  reactions: Reaction[];
  winners: WinnerResult[];
}

const partySettingsInputSchema = z
  .object({
    maxSubmissionsPerParticipant: z.number().int().min(1).max(20),
    maxQueueSize: z.number().int().min(3).max(100),
    maxDurationMinutes: z.number().int().min(5).max(240),
    votingLockSeconds: z.number().int().min(10).max(900),
    allowDiscordVoice: z.boolean(),
    allowUploads: z.boolean(),
    allowAudius: z.boolean(),
    allowSpotify: z.boolean(),
  })
  .partial()
  .refine(
    (settings) => {
      const next = { ...defaultPartySettings(), ...settings };
      return next.allowUploads || next.allowAudius || next.allowSpotify;
    },
    { message: "At least one song source must be enabled." },
  );

export const createPartySchema = z.object({
  title: z.string().trim().min(2).max(80),
  hostName: z.string().trim().min(1).max(40),
  mode: z.enum(partyModes).default("focus"),
  settings: partySettingsInputSchema.optional(),
});

export const joinPartySchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  source: z.enum(["web", "discord", "overlay"]).default("web"),
  participantToken: z.string().min(8).optional(),
});

export const audiusSearchSchema = z.object({
  q: z.string().trim().min(2).max(120),
});

export const addTrackSchema = z.object({
  participantToken: z.string().min(8),
  sourceType: z.enum(["audius", "spotify", "upload"]),
  sourceId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  artist: z.string().trim().min(1).max(160),
  artworkUrl: z.string().url().optional().nullable(),
  streamUrl: z.string().url().optional().nullable(),
  durationSeconds: z.number().int().min(1).max(7200),
});

export const updateRankingSchema = z.object({
  participantToken: z.string().min(8),
  trackIds: z.array(z.string().min(1)).max(3),
});

export const saveTrackSchema = z.object({
  participantToken: z.string().min(8),
  trackId: z.string().min(1),
});

export const playbackCommandSchema = z.object({
  participantToken: z.string().min(8),
});

export const reactionSchema = z.object({
  participantToken: z.string().min(8),
  trackId: z.string().min(1),
  type: z.enum(reactionTypes),
});

export function defaultPartySettings(): PartySettings {
  return {
    maxSubmissionsPerParticipant: 3,
    maxQueueSize: 24,
    maxDurationMinutes: 45,
    votingLockSeconds: 90,
    allowDiscordVoice: true,
    allowUploads: true,
    allowAudius: true,
    allowSpotify: true,
  };
}

export function normalizeRanking(trackIds: string[]): BallotRank[] {
  return [...new Set(trackIds)].slice(0, 3).map((trackId, index) => ({
    trackId,
    rank: index + 1,
  }));
}

export function putTrackInTopThree(currentTop: string[], trackId: string): string[] {
  return [trackId, ...currentTop.filter((id) => id !== trackId)].slice(0, 3);
}

export function scoreBallots(tracks: Track[], ballots: Ballot[]): WinnerResult[] {
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const scores = new Map<string, WinnerResult>();
  const pointsByRank = new Map([
    [1, 5],
    [2, 3],
    [3, 1],
  ]);

  for (const ballot of ballots) {
    const seen = new Set<string>();
    for (const rank of ballot.ranks) {
      if (seen.has(rank.trackId)) continue;
      const track = trackById.get(rank.trackId);
      const points = pointsByRank.get(rank.rank) ?? 0;
      if (!track || points === 0) continue;
      seen.add(rank.trackId);
      const existing =
        scores.get(rank.trackId) ??
        {
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          submittedByName: track.submittedByName,
          score: 0,
          firstPlaceVotes: 0,
          appearances: 0,
          queuePosition: track.queuePosition,
        };
      existing.score += points;
      existing.appearances += 1;
      if (rank.rank === 1) existing.firstPlaceVotes += 1;
      scores.set(rank.trackId, existing);
    }
  }

  return [...scores.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.firstPlaceVotes !== a.firstPlaceVotes) return b.firstPlaceVotes - a.firstPlaceVotes;
    if (b.appearances !== a.appearances) return b.appearances - a.appearances;
    return a.queuePosition - b.queuePosition;
  });
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
