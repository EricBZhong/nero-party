import type { PartyState } from "@nero/shared";
import { formatTime } from "../App";
import { TrackArtwork } from "./shared/TrackArtwork";

interface QueueDrawerProps {
  state: PartyState;
  onClose: () => void;
}

export function QueueDrawer({ state, onClose }: QueueDrawerProps) {
  const playing = state.tracks.filter((t) => t.status === "playing");
  const queued = state.tracks
    .filter((t) => t.status === "queued")
    .sort((a, b) => a.queuePosition - b.queuePosition);
  const played = state.tracks
    .filter((t) => t.status === "played")
    .sort((a, b) => b.queuePosition - a.queuePosition);

  return (
    <div className="drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer queue-drawer">
        <div className="drawer-header">
          <div>
            <span className="drawer-kicker">Queue</span>
            <h2 className="drawer-title">{state.tracks.length} tracks</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="drawer-body">
          {/* Now playing */}
          {playing.map((track) => (
            <div key={track.id} className="queue-row queue-row-live">
              <TrackArtwork track={track} size="tiny" />
              <div className="queue-row-info">
                <strong>{track.title}</strong>
                <span>{track.artist} · {track.submittedByName}</span>
              </div>
              <span className="queue-row-badge">Now</span>
            </div>
          ))}

          {/* Up next */}
          {queued.length > 0 && (
            <>
              <div className="queue-section-label">Up next</div>
              {queued.map((track, i) => (
                <div key={track.id} className="queue-row">
                  <span className="queue-row-pos">{i + 1}</span>
                  <TrackArtwork track={track} size="tiny" />
                  <div className="queue-row-info">
                    <strong>{track.title}</strong>
                    <span>{track.artist} · {track.submittedByName}</span>
                  </div>
                  <span className="queue-row-duration">{formatTime(track.durationSeconds)}</span>
                </div>
              ))}
            </>
          )}

          {/* Played */}
          {played.length > 0 && (
            <>
              <div className="queue-section-label">Played</div>
              {played.map((track) => (
                <div key={track.id} className="queue-row queue-row-played">
                  <TrackArtwork track={track} size="tiny" />
                  <div className="queue-row-info">
                    <strong>{track.title}</strong>
                    <span>{track.artist}</span>
                  </div>
                  <span className="queue-row-duration">{formatTime(track.durationSeconds)}</span>
                </div>
              ))}
            </>
          )}

          {state.tracks.length === 0 && (
            <div className="queue-empty">
              <p>No songs yet. Add the first track to get started.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
