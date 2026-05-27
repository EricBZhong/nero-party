import { useState } from "react";
import type { Participant, PartyState, Track } from "@nero/shared";
import type { Flash } from "../App";
import { getErrorMessage, getParticipantRanking } from "../App";
import { updateRanking } from "../lib/api";
import { TrackArtwork } from "./shared/TrackArtwork";

interface RankingDrawerProps {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  tracks: Track[];
  onFlash: (flash: Flash) => void;
  onClose: () => void;
}

export function RankingDrawer({
  state,
  participant,
  participantToken,
  tracks,
  onFlash,
  onClose,
}: RankingDrawerProps) {
  const currentRanking = getParticipantRanking(state, participant.id);
  const [localRanking, setLocalRanking] = useState<string[]>(currentRanking);
  const [saving, setSaving] = useState(false);
  const isFinalized = state.party.status === "finalized";

  const rankedTracks = localRanking
    .map((id) => state.tracks.find((t) => t.id === id))
    .filter(Boolean) as Track[];

  const listenedHistory = tracks.filter((t) => !localRanking.includes(t.id));
  const isDirty = JSON.stringify(localRanking) !== JSON.stringify(currentRanking);

  function addToRanking(trackId: string) {
    if (localRanking.length >= 3 || localRanking.includes(trackId)) return;
    setLocalRanking([...localRanking, trackId]);
  }

  function removeFromRanking(trackId: string) {
    setLocalRanking(localRanking.filter((id) => id !== trackId));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...localRanking];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setLocalRanking(next);
  }

  function moveDown(index: number) {
    if (index >= localRanking.length - 1) return;
    const next = [...localRanking];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setLocalRanking(next);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateRanking(participant.id, participantToken, localRanking);
      onFlash({ tone: "good", message: "Top 3 saved." });
      onClose();
    } catch (e) {
      onFlash({ tone: "bad", message: getErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer ranking-drawer">
        <div className="drawer-header">
          <div>
            <span className="drawer-kicker">Private ranking</span>
            <h2 className="drawer-title">Your Top 3</h2>
            <p className="drawer-subtitle">Use the arrows to reorder. Only you can see this.</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="drawer-body">
          {/* Ranked slots */}
          <div className="ranking-slots">
            {[0, 1, 2].map((i) => {
              const track = rankedTracks[i];
              const isNowPlaying = track?.id === state.playback.currentTrackId;
              return (
                <div key={i} className={`ranking-slot ${track ? "ranking-slot-filled" : "ranking-slot-empty"}`}>
                  <span className="ranking-slot-number">{i + 1}</span>
                  {track ? (
                    <>
                      <TrackArtwork track={track} size="small" />
                      <div className="ranking-slot-info">
                        <strong>{track.title}</strong>
                        <span>{track.artist}</span>
                        {isNowPlaying && <span className="ranking-now-badge">Now playing</span>}
                      </div>
                      <div className="ranking-slot-actions">
                        {i > 0 && (
                          <button className="ranking-move-btn" onClick={() => moveUp(i)} disabled={isFinalized}>
                            <ChevronUp />
                          </button>
                        )}
                        {i < localRanking.length - 1 && (
                          <button className="ranking-move-btn" onClick={() => moveDown(i)} disabled={isFinalized}>
                            <ChevronDown />
                          </button>
                        )}
                        {!isFinalized && (
                          <button className="ranking-remove-btn" onClick={() => removeFromRanking(track.id)}>
                            <XIcon />
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="ranking-slot-placeholder">
                      {isFinalized ? "Empty" : "Pick from history below"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Listened history */}
          {!isFinalized && listenedHistory.length > 0 && (
            <div className="ranking-history">
              <div className="ranking-history-header">
                <span>Listened history</span>
              </div>
              <div className="ranking-history-list">
                {listenedHistory.map((track) => (
                  <button
                    key={track.id}
                    className="ranking-history-row"
                    onClick={() => addToRanking(track.id)}
                    disabled={localRanking.length >= 3}
                  >
                    <TrackArtwork track={track} size="tiny" />
                    <div className="ranking-history-info">
                      <strong>{track.title}</strong>
                      <span>{track.artist}</span>
                    </div>
                    {localRanking.length < 3 && (
                      <span className="ranking-add-badge">+ Add</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!isFinalized && (
          <div className="drawer-footer">
            <button
              className="drawer-cta"
              onClick={handleSave}
              disabled={saving || !isDirty}
            >
              {saving ? "Saving..." : "Save as Top 3"}
            </button>
            <p className="drawer-footer-note">
              This saves your current ranking as your Top 3. It won't change the room's queue.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ChevronUp() {
  return (
    <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
