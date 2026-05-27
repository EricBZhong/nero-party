import type { PartyState } from "@nero/shared";
import { TrackArtwork } from "./shared/TrackArtwork";

interface QueuePreviewProps {
  state: PartyState;
  onOpenQueue: () => void;
}

export function QueuePreview({ state, onOpenQueue }: QueuePreviewProps) {
  const queued = state.tracks
    .filter((t) => t.status === "queued" || t.status === "playing")
    .sort((a, b) => a.queuePosition - b.queuePosition);

  const visible = queued.slice(0, 8);
  const remaining = queued.length - visible.length;

  return (
    <div className="queue-preview">
      <div className="queue-preview-header">
        <span className="queue-preview-kicker">Up next</span>
        <span className="queue-preview-count">{queued.length}</span>
      </div>

      {visible.length === 0 ? (
        <div className="queue-preview-empty">
          <p>No songs in queue yet.</p>
        </div>
      ) : (
        <div className="queue-preview-list">
          {visible.map((track, i) => (
            <div
              key={track.id}
              className={`queue-preview-item ${track.status === "playing" ? "queue-preview-item-live" : ""}`}
            >
              <span className="queue-preview-pos">
                {track.status === "playing" ? (
                  <PlayingBars />
                ) : (
                  i + 1
                )}
              </span>
              <TrackArtwork track={track} size="tiny" />
              <div className="queue-preview-meta">
                <strong>{track.title}</strong>
                <span>{track.artist} · {track.submittedByName}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {(queued.length > 0 || remaining > 0) && (
        <button className="queue-preview-more" onClick={onOpenQueue}>
          {remaining > 0 ? `+${remaining} more · See full queue` : "See full queue"}
        </button>
      )}
    </div>
  );
}

function PlayingBars() {
  return (
    <span className="playing-bars">
      <span /><span /><span />
    </span>
  );
}
