import { useState } from "react";
import type { PartyMode, PartySettings } from "@nero/shared";
import { createParty } from "../lib/api";

interface EntryProps {
  routeCode: string;
  loading: boolean;
  onCreate: (input: Parameters<typeof createParty>[0]) => void;
  onJoin: (code: string, displayName: string) => void;
}

export function Entry({ routeCode, loading, onCreate, onJoin }: EntryProps) {
  const [tab, setTab] = useState<"create" | "join">(routeCode ? "join" : "create");
  const [title, setTitle] = useState("Nero afterhours");
  const [hostName, setHostName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState(routeCode);

  // Settings
  const [maxQueueSize, setMaxQueueSize] = useState(18);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState(45);
  const [maxSubmissions, setMaxSubmissions] = useState(3);
  const [allowAudius, setAllowAudius] = useState(true);
  const [allowUploads, setAllowUploads] = useState(true);
  const [allowSpotify, setAllowSpotify] = useState(true);

  const mode: PartyMode = "focus";
  const enabledCount = [allowAudius, allowUploads, allowSpotify].filter(Boolean).length;

  const settings: PartySettings = {
    maxSubmissionsPerParticipant: maxSubmissions,
    maxQueueSize,
    maxDurationMinutes,
    votingLockSeconds: 90,
    allowDiscordVoice: false,
    allowUploads,
    allowAudius,
    allowSpotify,
  };

  return (
    <section className="entry-shell">
      {/* Background hero */}
      <div className="entry-hero">
        <img src="/assets/login-hero.png" alt="" className="entry-hero-img" />
        <div className="entry-hero-overlay" />
      </div>

      {/* Content */}
      <div className="entry-content">
        <div className="entry-header">
          <div className="entry-brand">
            <span className="entry-brand-dot" />
            <span>Nero Party</span>
          </div>
          <h1 className="entry-title">
            {tab === "create" ? "Start a listening party" : "Join a listening party"}
          </h1>
          <p className="entry-subtitle">
            {tab === "create"
              ? "One room. Full songs. A private Top 3 ballot."
              : "Enter the room code to join an active session."}
          </p>
        </div>

        {/* Tab switch */}
        <div className="entry-tabs">
          <button
            className={`entry-tab ${tab === "create" ? "entry-tab-active" : ""}`}
            onClick={() => setTab("create")}
            type="button"
          >
            Create
          </button>
          <button
            className={`entry-tab ${tab === "join" ? "entry-tab-active" : ""}`}
            onClick={() => setTab("join")}
            type="button"
          >
            Join
          </button>
        </div>

        {tab === "create" ? (
          <form
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              onCreate({ title, hostName: hostName || "Host", mode, settings });
            }}
          >
            <div className="entry-field">
              <label className="entry-label">Party title</label>
              <input
                className="entry-input entry-input-lg"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Friday night vibes"
                minLength={2}
                maxLength={80}
              />
            </div>

            <div className="entry-field">
              <label className="entry-label">Your name</label>
              <input
                className="entry-input"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                placeholder="Host"
                maxLength={40}
              />
            </div>

            {/* Room settings */}
            <div className="entry-settings">
              <div className="entry-settings-header">
                <span className="entry-settings-title">Room rules</span>
              </div>

              <div className="entry-controls-grid">
                <SettingControl
                  label="Song cap"
                  value={maxQueueSize}
                  min={3}
                  max={100}
                  suffix="tracks"
                  onChange={setMaxQueueSize}
                />
                <SettingControl
                  label="Time limit"
                  value={maxDurationMinutes}
                  min={5}
                  max={240}
                  step={5}
                  suffix="min"
                  onChange={setMaxDurationMinutes}
                />
                <SettingControl
                  label="Per person"
                  value={maxSubmissions}
                  min={1}
                  max={20}
                  suffix="songs"
                  onChange={setMaxSubmissions}
                />
              </div>

              <div className="entry-sources">
                <SourceChip
                  label="Audius"
                  active={allowAudius}
                  locked={allowAudius && enabledCount === 1}
                  onClick={() => setAllowAudius((v) => (v && enabledCount === 1 ? v : !v))}
                />
                <SourceChip
                  label="Uploads"
                  active={allowUploads}
                  locked={allowUploads && enabledCount === 1}
                  onClick={() => setAllowUploads((v) => (v && enabledCount === 1 ? v : !v))}
                />
                <SourceChip
                  label="Spotify"
                  active={allowSpotify}
                  locked={allowSpotify && enabledCount === 1}
                  onClick={() => setAllowSpotify((v) => (v && enabledCount === 1 ? v : !v))}
                />
              </div>
            </div>

            <button className="entry-cta" disabled={loading} type="submit">
              {loading ? "Creating..." : "Create party"}
            </button>
          </form>
        ) : (
          <form
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              onJoin(joinCode, displayName || "Listener");
            }}
          >
            <div className="entry-field">
              <label className="entry-label">Room code</label>
              <input
                className="entry-input entry-input-lg uppercase"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ABCD12"
                minLength={3}
                maxLength={8}
              />
            </div>

            <div className="entry-field">
              <label className="entry-label">Your name</label>
              <input
                className="entry-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Listener"
                maxLength={40}
              />
            </div>

            <button className="entry-cta" disabled={loading || !joinCode} type="submit">
              {loading ? "Joining..." : "Join party"}
            </button>
          </form>
        )}

        <p className="entry-policy">
          Full songs from uploads, Audius, or your own Spotify device. No extraction.
        </p>
      </div>
    </section>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SettingControl({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="setting-control">
      <span className="setting-control-label">{label}</span>
      <div className="setting-control-value">
        <input
          type="number"
          className="setting-number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const n = e.currentTarget.valueAsNumber;
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
          }}
        />
        <span className="setting-suffix">{suffix}</span>
      </div>
    </div>
  );
}

function SourceChip({
  label,
  active,
  locked,
  onClick,
}: {
  label: string;
  active: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`source-chip ${active ? "source-chip-active" : ""}`}
      disabled={locked}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
