interface TrackArtworkProps {
  track: { title?: string; artworkUrl?: string | null } | null;
  size: "large" | "medium" | "small" | "tiny";
}

const sizeMap = {
  large: "artwork artwork-lg",
  medium: "artwork artwork-md",
  small: "artwork artwork-sm",
  tiny: "artwork artwork-xs",
};

export function TrackArtwork({ track, size }: TrackArtworkProps) {
  const cls = sizeMap[size];

  if (!track?.artworkUrl) {
    return (
      <div className={`${cls} artwork-empty`}>
        <RecordIcon size={size} />
      </div>
    );
  }

  return (
    <div className={cls}>
      <img
        src={track.artworkUrl}
        alt={track.title}
        className="artwork-img"
        loading="lazy"
      />
    </div>
  );
}

function RecordIcon({ size }: { size: string }) {
  const s = size === "large" ? 48 : size === "medium" ? 32 : size === "small" ? 24 : 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className="artwork-record-icon">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="0.5" opacity="0.5" />
    </svg>
  );
}
