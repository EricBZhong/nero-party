import type { Participant, PartyState, Track } from "@nero/shared";
import type { Flash } from "../App";
import { formatTime } from "../App";
import { TrackArtwork } from "./shared/TrackArtwork";

interface OverlayPreviewProps {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  currentTrack: Track | null;
  onFlash: (flash: Flash) => void;
  onClose: () => void;
}

export function OverlayPreview({
  state,
  participant,
  participantToken,
  currentTrack,
  onFlash,
  onClose,
}: OverlayPreviewProps) {
  const progress = currentTrack
    ? Math.min(100, (state.playback.positionSeconds / currentTrack.durationSeconds) * 100)
    : 0;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-preview-modal">
        {/* Header */}
        <div className="overlay-preview-header">
          <span className="overlay-preview-title">Desktop Overlay Preview</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Fake game background */}
        <div className="overlay-demo-bg">
          <div className="overlay-demo-shapes">
            <div className="overlay-demo-shape-1" />
            <div className="overlay-demo-shape-2" />
          </div>

          {/* The overlay widget */}
          <div className="overlay-widget">
            <div className="overlay-widget-bar">
              <span className="overlay-widget-dot" />
              <span className="overlay-widget-label">Nero Party</span>
              <span className="overlay-widget-code">{state.party.code}</span>
            </div>

            {currentTrack ? (
              <div className="overlay-widget-track">
                <TrackArtwork track={currentTrack} size="small" />
                <div className="overlay-widget-info">
                  <strong>{currentTrack.title}</strong>
                  <span>{currentTrack.artist}</span>
                  <div className="overlay-widget-progress">
                    <div className="overlay-widget-bar-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="overlay-widget-time">
                    <span>{formatTime(state.playback.positionSeconds)}</span>
                    <span>{formatTime(currentTrack.durationSeconds)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="overlay-widget-empty">
                <p>Waiting for playback...</p>
              </div>
            )}

            <div className="overlay-widget-footer">
              <span>{state.participants.length} listening</span>
              <span>{state.tracks.filter((t) => t.status === "queued").length} in queue</span>
            </div>
          </div>
        </div>

        <p className="overlay-preview-note">
          This is how the overlay appears on top of games or other apps. Use the companion URL for the real overlay.
        </p>
      </div>
    </div>
  );
}
