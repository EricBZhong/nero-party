import type { Participant, PartyState, Track } from "@nero/shared";
import { putTrackInTopThree } from "@nero/shared";
import type { Flash } from "../App";
import { formatTime, getErrorMessage, getParticipantRanking } from "../App";
import { saveTrack, updateRanking } from "../lib/api";
import { TrackArtwork } from "./shared/TrackArtwork";

interface OverlayShellProps {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  currentTrack: Track | null;
  onFlash: (flash: Flash) => void;
}

export function OverlayShell({
  state,
  participant,
  participantToken,
  currentTrack,
  onFlash,
}: OverlayShellProps) {
  const ranking = getParticipantRanking(state, participant.id);
  const isSaved = currentTrack
    ? state.savedTracks.some(
        (s) => s.participantId === participant.id && s.trackId === currentTrack.id
      )
    : false;
  const isInTop3 = currentTrack ? ranking.includes(currentTrack.id) : false;
  const progress = currentTrack
    ? Math.min(100, (state.playback.positionSeconds / currentTrack.durationSeconds) * 100)
    : 0;

  async function handleSave() {
    if (!currentTrack) return;
    try {
      await saveTrack(participant.id, participantToken, currentTrack.id);
      onFlash({ tone: "good", message: "Saved." });
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
      onFlash({ tone: "good", message: "Added to Top 3." });
    } catch (e) {
      onFlash({ tone: "bad", message: getErrorMessage(e) });
    }
  }

  return (
    <div className="overlay-shell-layout">
      <div className="overlay-shell-card">
        {/* Header */}
        <div className="overlay-shell-header">
          <span className="live-dot" />
          <span className="overlay-shell-title">Nero Party</span>
          <span className="overlay-shell-code">{state.party.code}</span>
        </div>

        {/* Now playing */}
        {currentTrack ? (
          <div className="overlay-now">
            <TrackArtwork track={currentTrack} size="small" />
            <div className="overlay-now-info">
              <strong>{currentTrack.title}</strong>
              <span>{currentTrack.artist}</span>
              <div className="overlay-progress-bar">
                <div className="overlay-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="overlay-time">
                <span>{formatTime(state.playback.positionSeconds)}</span>
                <span>{formatTime(currentTrack.durationSeconds)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="overlay-waiting">
            <p>Waiting for playback...</p>
          </div>
        )}

        {/* Actions */}
        {currentTrack && (
          <div className="overlay-actions">
            <button
              className={`overlay-action-btn ${isSaved ? "overlay-action-confirmed" : ""}`}
              onClick={handleSave}
            >
              Save
            </button>
            <button
              className={`overlay-action-btn ${isInTop3 ? "overlay-action-confirmed" : ""}`}
              onClick={handleTopThree}
            >
              Top 3
            </button>
          </div>
        )}

        {/* Top 3 preview */}
        <div className="overlay-top3">
          <span className="overlay-top3-label">Your Top 3</span>
          <div className="overlay-top3-slots">
            {[0, 1, 2].map((i) => {
              const track = ranking[i] ? state.tracks.find((t) => t.id === ranking[i]) : null;
              return (
                <div key={i} className="overlay-top3-slot">
                  <span className="overlay-top3-num">{i + 1}</span>
                  <span className="overlay-top3-name">{track?.title ?? "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
