import type { Participant, PartyState, Track } from "@nero/shared";
import { putTrackInTopThree } from "@nero/shared";
import { saveTrack, updateRanking } from "../lib/api";
import type { Flash } from "../App";
import { formatTime, getErrorMessage, getParticipantRanking } from "../App";
import { TrackArtwork } from "./shared/TrackArtwork";

interface NowPlayingProps {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  currentTrack: Track | null;
  onFlash: (flash: Flash) => void;
  onOpenAddSong: () => void;
  onOpenRanking: () => void;
}

export function NowPlaying({
  state,
  participant,
  participantToken,
  currentTrack,
  onFlash,
  onOpenAddSong,
  onOpenRanking,
}: NowPlayingProps) {
  const isFinalized = state.party.status === "finalized";
  const queuedPreview = state.tracks.find((t) => t.status === "queued") ?? null;
  const winnerTrack = state.winners[0]
    ? state.tracks.find((t) => t.id === state.winners[0].trackId) ?? null
    : null;

  const heroTrack = currentTrack ?? (isFinalized ? winnerTrack : queuedPreview);
  const isPreview = !currentTrack && !!queuedPreview && !isFinalized;
  const waitingCount = state.tracks.filter((t) => t.status === "queued").length;

  const progress = currentTrack
    ? Math.min(100, (state.playback.positionSeconds / currentTrack.durationSeconds) * 100)
    : 0;

  // Status label
  const stageLabel = isFinalized
    ? "Final reveal"
    : currentTrack
      ? "Now playing"
      : isPreview
        ? "Up next"
        : "Waiting for songs";

  const stageNote = isFinalized
    ? "Ballots locked. The room winner is live."
    : currentTrack?.sourceType === "spotify"
      ? "Playing on each listener's Spotify device"
      : currentTrack
        ? `Queued by ${currentTrack.submittedByName}`
        : isPreview
          ? `${waitingCount} in queue. Host can start.`
          : "Add a song to get started.";

  // Quick actions state
  const ranking = getParticipantRanking(state, participant.id);
  const isSaved = state.savedTracks.some(
    (s) => s.participantId === participant.id && s.trackId === currentTrack?.id
  );
  const isInTop3 = currentTrack ? ranking.includes(currentTrack.id) : false;

  async function handleSave() {
    if (!currentTrack) return;
    try {
      await saveTrack(participant.id, participantToken, currentTrack.id);
      onFlash({ tone: "good", message: "Saved to your playlist." });
    } catch (e) {
      onFlash({ tone: "bad", message: getErrorMessage(e) });
    }
  }

  async function handleTopThree() {
    if (!currentTrack) return;
    try {
      await updateRanking(
        participant.id,
        participantToken,
        putTrackInTopThree(ranking, currentTrack.id)
      );
      onFlash({ tone: "good", message: "Added to your Top 3." });
    } catch (e) {
      onFlash({ tone: "bad", message: getErrorMessage(e) });
    }
  }

  return (
    <div className="now-playing">
      {/* Stage background effects */}
      <div className="stage-glow" aria-hidden />

      {/* Status pill */}
      <div className="stage-status">
        <span className={`stage-status-dot ${currentTrack ? "stage-status-dot-live" : ""}`} />
        <span>{stageLabel}</span>
      </div>

      {/* Artwork */}
      <TrackArtwork track={heroTrack} size="large" />

      {/* Track info */}
      <h1 className="stage-track-title">
        {heroTrack?.title ?? "What belongs in your Top 3?"}
      </h1>
      <p className="stage-track-artist">
        {isFinalized && state.winners[0]
          ? `${state.winners[0].score} points · ${state.winners[0].firstPlaceVotes} first-place`
          : heroTrack?.artist ?? "Listen together, rank your favorites."}
      </p>
      <p className="stage-note">{stageNote}</p>

      {/* Waveform progress */}
      {currentTrack && (
        <div className="stage-progress">
          <div className="waveform">
            {Array.from({ length: 64 }).map((_, i) => (
              <span
                key={i}
                className="waveform-bar"
                style={{
                  height: `${20 + ((i * 17) % 60)}%`,
                  opacity: i / 64 <= progress / 100 ? 1 : 0.25,
                }}
              />
            ))}
          </div>
          <div className="stage-time">
            <span>{formatTime(state.playback.positionSeconds)}</span>
            <span>{formatTime(currentTrack.durationSeconds)}</span>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="stage-actions">
        {currentTrack ? (
          <>
            <button
              className={`action-pill action-pill-save ${isSaved ? "action-pill-confirmed" : ""}`}
              onClick={handleSave}
            >
              <HeartIcon filled={isSaved} />
              Save
            </button>
            <button
              className={`action-pill action-pill-top3 ${isInTop3 ? "action-pill-confirmed" : ""}`}
              onClick={handleTopThree}
            >
              <StarIcon filled={isInTop3} />
              Top 3
            </button>
          </>
        ) : (
          <button className="action-pill action-pill-add" onClick={onOpenAddSong}>
            <PlusIcon />
            {state.tracks.length === 0 ? "Add first song" : "Add a song"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
