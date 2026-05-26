import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  BarChart3,
  ChevronRight,
  Clock,
  Crown,
  Disc3,
  DoorOpen,
  GripVertical,
  Heart,
  Headphones,
  ListMusic,
  Loader2,
  type LucideIcon,
  Maximize2,
  Minimize2,
  Music2,
  PanelRightOpen,
  Play,
  Plus,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  Trophy,
  Upload,
  Users,
  X,
} from "lucide-react";
import type { Ballot, Participant, PartyMode, PartySettings, PartyState, Track } from "@nero/shared";
import { putTrackInTopThree, scoreBallots } from "@nero/shared";
import {
  addTrack,
  advancePlayback,
  createParty,
  finalizeParty,
  getSpotifyStatus,
  getParty,
  joinParty,
  saveTrack,
  searchAudius,
  searchSpotify,
  startPlayback,
  spotifyLoginUrl,
  updateRanking,
  uploadAudio,
  type SearchTrack,
  type SpotifyStatus,
} from "./lib/api";
import { socket } from "./lib/socket";

type Surface = "web" | "overlay";
type FocusLayer = "submit" | "ranking" | "queue" | "overlay" | null;
type Flash = { tone: "good" | "warn" | "bad"; message: string } | null;
type LeaveIntent = "room" | null;

const route = parseRoute();
const surfaceProof = [
  { name: "Create / join", detail: "Room setup with preview", initials: "01", image: "/assets/surface-map/create-join.png" },
  { name: "Focus room", detail: "Current song as the room", initials: "02", image: "/assets/surface-map/focus-room.png" },
  { name: "Add song modal", detail: "Audius search and uploads", initials: "03", image: "/assets/surface-map/add-song.png" },
  { name: "Top 3 drawer", detail: "Private ranking layer", initials: "04", image: "/assets/surface-map/top3-drawer.png" },
  { name: "Overlay panel", detail: "Alt / Option + X multitasking", initials: "05", image: "/assets/surface-map/overlay-panel.png" },
  { name: "Leaderboard", detail: "Room-wide proof", initials: "06", image: "/assets/surface-map/leaderboard.png" },
  { name: "Final reveal", detail: "Live scoring moment", initials: "07", image: "/assets/surface-map/final-reveal.png" },
  { name: "Saved playlist", detail: "Personal takeaways", initials: "08", image: "/assets/surface-map/saved-playlist.png" },
];
const rotatingMoments = ["current song", "top three", "saved playlist", "shared queue"];

function App() {
  const [partyCode, setPartyCode] = useState(route.code);
  const [participantToken, setParticipantToken] = useState(route.code ? localStorage.getItem(tokenKey(route.code)) ?? "" : "");
  const [state, setState] = useState<PartyState | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [leaveIntent, setLeaveIntent] = useState<LeaveIntent>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentParticipant = useMemo(
    () => state?.participants.find((participant) => participant.token === participantToken) ?? null,
    [state, participantToken],
  );
  const currentTrack = useMemo(() => state?.tracks.find((track) => track.id === state.playback.currentTrackId) ?? null, [state]);
  const isHost = currentParticipant?.role === "host";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const spotifyResult = params.get("spotify");
    if (!spotifyResult) return;
    setFlash(
      spotifyResult === "connected"
        ? { tone: "good", message: "Spotify connected. Spotify tracks will start on linked listener devices." }
        : { tone: "bad", message: "Spotify connection failed. Reconnect, then open Spotify on the playback device." },
    );
    params.delete("spotify");
    const nextSearch = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`);
  }, []);

  useEffect(() => {
    if (!partyCode) return;
    getParty(partyCode)
      .then((nextState) => setState(nextState))
      .catch((error: Error) => setFlash({ tone: "bad", message: error.message }));
  }, [partyCode]);

  useEffect(() => {
    if (!partyCode) return;
    if (!socket.connected) socket.connect();

    const onConnect = () => {
      setConnected(true);
      socket.emit("party:subscribe", { partyCode, participantToken });
    };
    const onDisconnect = () => setConnected(false);
    const onState = (nextState: PartyState) => setState(nextState);
    const onError = (payload: { message?: string }) => setFlash({ tone: "bad", message: payload.message ?? "Room connection failed." });

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("party:state", onState);
    socket.on("party:error", onError);
    socket.emit("party:subscribe", { partyCode, participantToken });

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("party:state", onState);
      socket.off("party:error", onError);
    };
  }, [partyCode, participantToken]);

  useEffect(() => {
    const onNotice = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail) setFlash({ tone: "warn", message: detail });
    };
    window.addEventListener("nero-overlay-notice", onNotice);
    return () => window.removeEventListener("nero-overlay-notice", onNotice);
  }, []);

  useEffect(() => {
    if (!participantToken || !socket.connected) return;
    const timer = window.setInterval(() => socket.emit("presence:heartbeat", { participantToken }), 15000);
    return () => window.clearInterval(timer);
  }, [participantToken, connected]);

  useEffect(() => {
    if (!participantToken || audioUnlocked) return;
    const primeAudio = () => {
      void unlockAudio();
    };
    window.addEventListener("pointerdown", primeAudio, { once: true, capture: true });
    window.addEventListener("keydown", primeAudio, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", primeAudio, true);
      window.removeEventListener("keydown", primeAudio, true);
    };
  }, [participantToken, audioUnlocked, currentTrack?.id, currentTrack?.streamUrl, state?.playback.isPlaying]);

  useEffect(() => {
    if (!audioRef.current || !state || !currentTrack?.streamUrl || !audioUnlocked) return;
    const audio = audioRef.current;
    const targetPosition = state.playback.positionSeconds;
    if (!audio.src || !audio.src.includes(currentTrack.streamUrl)) {
      audio.src = currentTrack.streamUrl;
    }
    if (Math.abs(audio.currentTime - targetPosition) > 2) {
      audio.currentTime = Math.min(targetPosition, Math.max(currentTrack.durationSeconds - 1, 0));
    }
    if (state.playback.isPlaying) {
      audio.play().catch(() => setFlash({ tone: "warn", message: "Tap once in the room if browser audio is blocked." }));
    } else {
      audio.pause();
    }
  }, [audioUnlocked, currentTrack, state?.playback.currentTrackId, state?.playback.isPlaying, state?.playback.positionSeconds]);

  async function handleCreate(input: Parameters<typeof createParty>[0]) {
    setIsJoining(true);
    setFlash(null);
    try {
      const created = await createParty(input);
      storeSession(created.partyCode, created.participantToken);
      setParticipantToken(created.participantToken);
      setPartyCode(created.partyCode);
      setState(created.state);
      window.history.replaceState(null, "", `/party/${created.partyCode}`);
    } catch (error) {
      setFlash({ tone: "bad", message: getErrorMessage(error) });
    } finally {
      setIsJoining(false);
    }
  }

  async function handleJoin(code: string, displayName: string, source: Surface = route.surface) {
    setIsJoining(true);
    setFlash(null);
    try {
      const joined = await joinParty(code, { displayName, source, participantToken: localStorage.getItem(tokenKey(code)) ?? undefined });
      storeSession(code, joined.participantToken);
      setParticipantToken(joined.participantToken);
      setPartyCode(code.toUpperCase());
      setState(joined.state);
      window.history.replaceState(null, "", route.surface === "overlay" ? `/companion/${code.toUpperCase()}?source=overlay` : `/party/${code.toUpperCase()}`);
    } catch (error) {
      setFlash({ tone: "bad", message: getErrorMessage(error) });
    } finally {
      setIsJoining(false);
    }
  }

  async function unlockAudio() {
    setAudioUnlocked(true);
    socket.emit("audio:ready", { participantToken, audioReady: true });
    const audio = audioRef.current;
    if (!audio || !currentTrack?.streamUrl) return;

    audio.muted = false;
    if (!audio.src.includes(currentTrack.streamUrl)) {
      audio.src = currentTrack.streamUrl;
    }
    audio.currentTime = Math.min(state?.playback.positionSeconds ?? 0, Math.max(currentTrack.durationSeconds - 1, 0));
    await audio.play().catch(() => undefined);
    if (!state?.playback.isPlaying) {
      audio.pause();
    }
  }

  function leaveRoom() {
    if (partyCode) localStorage.removeItem(tokenKey(partyCode));
    setParticipantToken("");
    setState(null);
    setPartyCode("");
    window.history.replaceState(null, "", "/");
  }

  return (
    <main className={`nero-app-shell min-h-screen bg-nero-ink text-white ${route.surface === "overlay" ? "overlay-shell" : ""}`}>
      <audio ref={audioRef} preload="auto" />
      <div className="nero-grid-bg fixed inset-0 pointer-events-none" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-none flex-col px-3 py-3 sm:px-4 lg:px-5">
        {flash ? <FlashBanner flash={flash} onDismiss={() => setFlash(null)} /> : null}

        {!state || !participantToken || !currentParticipant ? (
          <Entry
            routeCode={partyCode}
            loading={isJoining}
            onCreate={handleCreate}
            onJoin={handleJoin}
            surface={route.surface}
          />
        ) : (
          <AuthenticatedSurface
            surface={route.surface}
            state={state}
            participant={currentParticipant}
            participantToken={participantToken}
            currentTrack={currentTrack}
            isHost={isHost}
            onUnlockAudio={unlockAudio}
            onFlash={setFlash}
            onStateChange={setState}
            onExpand={() => undefined}
            onLeave={() => setLeaveIntent("room")}
          />
        )}
        {leaveIntent ? (
          <ConfirmLeaveModal
            onCancel={() => setLeaveIntent(null)}
            onConfirm={() => {
              setLeaveIntent(null);
              leaveRoom();
            }}
          />
        ) : null}
      </div>
    </main>
  );
}

function AuthenticatedSurface({
  surface,
  state,
  participant,
  participantToken,
  currentTrack,
  isHost,
  onUnlockAudio,
  onFlash,
  onStateChange,
  onExpand,
  onLeave,
}: {
  surface: Surface;
  state: PartyState;
  participant: Participant;
  participantToken: string;
  currentTrack: Track | null;
  isHost: boolean;
  onUnlockAudio: () => Promise<void>;
  onFlash: (flash: Flash) => void;
  onStateChange: (state: PartyState) => void;
  onExpand: () => void;
  onLeave: () => void;
}) {
  const companion = (
    <CompanionRoom
      state={state}
      participant={participant}
      participantToken={participantToken}
      currentTrack={currentTrack}
      onFlash={onFlash}
      onExpand={onExpand}
      surface={surface}
    />
  );

  const focus = (
    <FocusRoom
      state={state}
      participant={participant}
      participantToken={participantToken}
      currentTrack={currentTrack}
      isHost={isHost}
      onUnlockAudio={onUnlockAudio}
      onFlash={onFlash}
      onStateChange={onStateChange}
      onLeave={onLeave}
    />
  );

  if (surface === "overlay") {
    return <DesktopOverlayFrame state={state}>{companion}</DesktopOverlayFrame>;
  }

  return focus;
}

function DesktopOverlayFrame({ state, children }: { state: PartyState; children: ReactNode }) {
  return (
    <section className="overlay-demo-frame z-10 my-4">
      <div className="overlay-game-backdrop" aria-hidden>
        <div className="overlay-game-shape overlay-game-shape-one" />
        <div className="overlay-game-shape overlay-game-shape-two" />
        <div className="overlay-game-crosshair" />
      </div>
      <div className="overlay-window">
        <div className="overlay-window-bar">
          <div className="flex min-w-0 items-center gap-2">
            <AudioLines className="h-4 w-4 text-nero-live" />
            <span className="truncate text-sm font-bold uppercase tracking-[0.16em]">Nero Party</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="tiny-button" title="Opacity" aria-label="Opacity"><SlidersHorizontal className="h-3.5 w-3.5" /></button>
            <button className="tiny-button" title="Collapse" aria-label="Collapse"><Minimize2 className="h-3.5 w-3.5" /></button>
            <button className="tiny-button" title="Close" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        {children}
        <div className="overlay-settings-strip">
          <span>Click-through <strong>On</strong></span>
          <span>Opacity <strong>85%</strong></span>
          <span>Alt / Option + X</span>
        </div>
      </div>
      <div className="overlay-collapsed-pill">
        <Music2 className="h-4 w-4 text-nero-live" />
        <span className="truncate">{state.party.title}</span>
        <AudioLines className="h-4 w-4 text-nero-live" />
      </div>
    </section>
  );
}

function Entry({
  routeCode,
  loading,
  onCreate,
  onJoin,
  surface,
}: {
  routeCode: string;
  loading: boolean;
  onCreate: (input: Parameters<typeof createParty>[0]) => void;
  onJoin: (code: string, displayName: string, source?: Surface) => void;
  surface: Surface;
}) {
  const [tab, setTab] = useState(routeCode ? "join" : "create");
  const [title, setTitle] = useState("Nero afterhours");
  const [hostName, setHostName] = useState("Host");
  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState(routeCode);
  const [maxQueueSize, setMaxQueueSize] = useState(18);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState(45);
  const [maxSubmissionsPerParticipant, setMaxSubmissionsPerParticipant] = useState(3);
  const [votingLockSeconds, setVotingLockSeconds] = useState(90);
  const [allowAudius, setAllowAudius] = useState(true);
  const [allowUploads, setAllowUploads] = useState(true);
  const [allowSpotify, setAllowSpotify] = useState(true);
  const mode: PartyMode = "focus";
  const enabledSourceCount = [allowAudius, allowUploads, allowSpotify].filter(Boolean).length;
  const pendingSettings: PartySettings = {
    maxSubmissionsPerParticipant,
    maxQueueSize,
    maxDurationMinutes,
    votingLockSeconds,
    allowDiscordVoice: false,
    allowUploads,
    allowAudius,
    allowSpotify,
  };

  return (
    <section className="entry-experience z-10 flex flex-1 flex-col gap-8 py-6 sm:py-10">
      <div className="setup-shell">
        <div className="setup-console">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-nero-live">Nero Party</p>
              <h2 className="entry-headline mt-2 max-w-xl text-4xl font-light leading-[0.95] sm:text-6xl">
                <span className="block">Keep the</span>
                <RotatingPhrase words={rotatingMoments} />
                <span className="block">in sync.</span>
              </h2>
            </div>
            <div className="inline-grid grid-flow-col rounded-md border border-white/10 bg-white/[0.04] p-1">
              <button
                className={`inline-flex h-9 items-center justify-center gap-2 rounded px-3 text-sm font-semibold transition ${tab === "create" ? "bg-nero-live text-nero-ink" : "text-white/65 hover:bg-white/10 hover:text-white"}`}
                onClick={() => setTab("create")}
                type="button"
              >
                <Plus className="h-4 w-4" />
                Create
              </button>
              <button
                className={`inline-flex h-9 items-center justify-center gap-2 rounded px-3 text-sm font-semibold transition ${tab === "join" ? "bg-nero-live text-nero-ink" : "text-white/65 hover:bg-white/10 hover:text-white"}`}
                onClick={() => setTab("join")}
                type="button"
              >
                <DoorOpen className="h-4 w-4" />
                Join
              </button>
            </div>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <MetricTile label="Song cap" value={`${maxQueueSize} tracks`} icon={ListMusic} />
            <MetricTile label="Timebox" value={`${maxDurationMinutes} min`} icon={Clock} />
            <MetricTile label="Sources" value={formatEnabledSources(pendingSettings)} icon={Shield} />
          </div>

          <div className="mt-8 rounded-[28px] border border-white/10 bg-black/30 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-5">
            {tab === "create" ? (
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  onCreate({
                    title,
                    hostName,
                    mode,
                    settings: pendingSettings,
                  });
                }}
              >
                <Field label="Party title">
                  <input className="field field-xl" value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} maxLength={80} />
                </Field>
                <Field label="Host name">
                  <input className="field" value={hostName} onChange={(event) => setHostName(event.target.value)} minLength={1} maxLength={40} />
                </Field>
                <div className="host-condition-panel">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-nero-live">Host conditions</p>
                      <h3 className="mt-1 text-lg font-semibold">Room rules before invites go out</h3>
                    </div>
                    <SlidersHorizontal className="h-5 w-5 text-nero-live" />
                  </div>
                  <div className="host-condition-grid">
                    <HostLimitControl
                      icon={ListMusic}
                      label="Song limit"
                      value={maxQueueSize}
                      min={3}
                      max={100}
                      suffix="tracks"
                      onChange={setMaxQueueSize}
                    />
                    <HostLimitControl
                      icon={Clock}
                      label="Time limit"
                      value={maxDurationMinutes}
                      min={5}
                      max={240}
                      step={5}
                      suffix="min"
                      onChange={setMaxDurationMinutes}
                    />
                    <HostLimitControl
                      icon={Ticket}
                      label="Per listener"
                      value={maxSubmissionsPerParticipant}
                      min={1}
                      max={20}
                      suffix="songs"
                      onChange={setMaxSubmissionsPerParticipant}
                    />
                    <HostLimitControl
                      icon={Trophy}
                      label="Voting lock"
                      value={votingLockSeconds}
                      min={10}
                      max={900}
                      step={10}
                      suffix="sec"
                      onChange={setVotingLockSeconds}
                    />
                  </div>
                  <div className="source-toggle-grid">
                    <SourceToggle
                      active={allowAudius}
                      disabled={allowAudius && enabledSourceCount === 1}
                      icon={Search}
                      label="Audius"
                      onClick={() => setAllowAudius((current) => (current && enabledSourceCount === 1 ? current : !current))}
                    />
                    <SourceToggle
                      active={allowUploads}
                      disabled={allowUploads && enabledSourceCount === 1}
                      icon={Upload}
                      label="Uploads"
                      onClick={() => setAllowUploads((current) => (current && enabledSourceCount === 1 ? current : !current))}
                    />
                    <SourceToggle
                      active={allowSpotify}
                      disabled={allowSpotify && enabledSourceCount === 1}
                      icon={Disc3}
                      label="Spotify"
                      onClick={() => setAllowSpotify((current) => (current && enabledSourceCount === 1 ? current : !current))}
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="setup-policy-card">
                    <Disc3 className="h-5 w-5 text-nero-live" />
                    <span>
                      <strong>Spotify listener playback</strong>
                      <span>Linked listener devices receive Spotify tracks.</span>
                    </span>
                  </div>
                  <div className="setup-policy-card">
                    <PanelRightOpen className="h-5 w-5 text-nero-live" />
                    <span>
                      <strong>Overlay stays</strong>
                      <span>Open the compact layer when multitasking.</span>
                    </span>
                  </div>
                </div>
                <button className="hero-cta h-12 justify-center" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Create party
                </button>
              </form>
            ) : (
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  onJoin(joinCode, displayName || "Listener", surface);
                }}
              >
                <Field label="Session code">
                  <input
                    className="field field-xl uppercase"
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                    minLength={3}
                    maxLength={8}
                  />
                </Field>
                <Field label="Display name">
                  <input
                    className="field"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Listener"
                    maxLength={40}
                  />
                </Field>
                <button className="hero-cta h-12 justify-center" disabled={loading || !joinCode}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                  Join party
                </button>
              </form>
            )}
          </div>
        </div>

        <SetupPreview title={tab === "create" ? title : "Listening party"} mode={mode} tab={tab} settings={pendingSettings} />
      </div>

      <SurfacePreviewStrip />
      <NeroFeatureWall />
    </section>
  );
}

function HostLimitControl({
  icon: Icon,
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  const update = (nextValue: number) => {
    if (!Number.isFinite(nextValue)) return;
    onChange(clampInt(nextValue, min, max));
  };

  return (
    <label className="host-limit-control">
      <span className="host-limit-label">
        <Icon className="h-4 w-4 text-nero-live" />
        {label}
      </span>
      <span className="host-limit-value">
        <input
          className="limit-number-input"
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => update(event.currentTarget.valueAsNumber)}
        />
        <small>{suffix}</small>
      </span>
      <input
        className="limit-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => update(event.currentTarget.valueAsNumber)}
        aria-label={label}
      />
    </label>
  );
}

function SourceToggle({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`source-toggle ${active ? "source-toggle-active" : ""}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function SetupOption({
  active,
  icon: Icon,
  title,
  copy,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  title: string;
  copy: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`setup-option ${active ? "setup-option-active" : ""}`} onClick={onClick}>
      <Icon className="h-5 w-5" />
      <span>
        <strong>{title}</strong>
        <span>{copy}</span>
      </span>
    </button>
  );
}

function SetupPreview({ title, mode, tab, settings }: { title: string; mode: PartyMode; tab: string; settings: PartySettings }) {
  return (
    <aside className="setup-preview">
      <img className="setup-preview-photo" src="/assets/login-hero.png" alt="" />
      <div className="setup-preview-shade" aria-hidden />
      <div className="relative flex h-full flex-col justify-between gap-6 p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <div className="live-context-pill">
            <span className="live-dot" />
            Live preview
          </div>
          <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-bold text-white/65">
            Focus room
          </span>
        </div>

        <div className="setup-preview-spacer" aria-hidden />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-nero-live">{tab === "create" ? "Ready to create" : "Ready to join"}</p>
            <h3 className="mt-2 text-3xl font-light leading-none">{title || "Untitled party"}</h3>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/58">
              The room opens as a live surface first. Queue, submit, ranking, and finale appear as layers when people need them.
            </p>
          </div>
          <div className="setup-preview-stats">
            <MiniSignal icon={ListMusic} label="Song cap" value={`${settings.maxQueueSize} tracks`} />
            <MiniSignal icon={Clock} label="Timebox" value={`${settings.maxDurationMinutes} min`} />
            <MiniSignal icon={Ticket} label="Per listener" value={`${settings.maxSubmissionsPerParticipant} songs`} />
            <MiniSignal icon={Trophy} label="Mode" value={mode === "focus" ? "Top 3" : "Companion"} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function RotatingPhrase({ words }: { words: string[] }) {
  return (
    <span className="phrase-window" aria-label={words.join(", ")}>
      <span className="phrase-track">
        {[...words, words[0]].map((word, index) => (
          <span key={`${word}-${index}`} className="phrase-chip">
            {word}
          </span>
        ))}
      </span>
    </span>
  );
}

function SurfacePreviewStrip() {
  const doubled = [...surfaceProof, ...surfaceProof, ...surfaceProof];
  return (
    <section className="surface-proof" aria-label="Nero Party surfaces">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-white/45">One room, two usable contexts</p>
          <h3 className="mt-2 text-4xl font-light sm:text-5xl">Built for the way groups actually listen</h3>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/55 sm:flex">
          <Headphones className="h-4 w-4 text-nero-live" />
          Product demo map
        </div>
      </div>
      <div className="surface-marquee">
        <div className="surface-marquee-track">
          {doubled.map((surface, index) => (
            <SurfaceTile key={`${surface.name}-${index}`} surface={surface} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SurfaceTile({ surface, index }: { surface: { name: string; detail: string; initials: string; image: string }; index: number }) {
  return (
    <div className="surface-tile group">
      <div className="surface-tile-art" style={{ backgroundImage: `url(${surface.image})` }}>
        <span>{surface.initials}</span>
      </div>
      <div className="absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/30" />
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 to-transparent p-4">
        <p className="truncate text-sm font-semibold">{surface.name}</p>
        <p className="text-xs text-white/58">{surface.detail}</p>
      </div>
      <span className="absolute right-3 top-3 rounded-full bg-black/40 px-2 py-1 text-[10px] font-black text-white/70">0{(index % surfaceProof.length) + 1}</span>
    </div>
  );
}

function NeroFeatureWall() {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <FeatureProofCard
        icon={ListMusic}
        title="Simple while multitasking"
        copy="The overlay keeps the core choice visible: Save, put it in Top 3, or keep listening."
        metric="One tap"
      />
      <FeatureProofCard
        icon={BarChart3}
        title="Deeper when focused"
        copy="Focus Mode opens the full queue, listened history, ballot editing, leaderboard, and final reveal."
        metric="Focus room"
      />
      <FeatureProofCard
        icon={Ticket}
        title="Real songs, clean control"
        copy="Uploads and Audius play in browser. Spotify starts on each linked listener's active Spotify device."
        metric="Rights-safe"
      />
    </section>
  );
}

function FeatureProofCard({ icon: Icon, title, copy, metric }: { icon: LucideIcon; title: string; copy: string; metric: string }) {
  return (
    <article className="feature-proof-card group">
      <div className="flex items-center justify-between gap-3">
        <Icon className="h-5 w-5 text-white/70 transition-transform duration-300 group-hover:scale-110 group-hover:text-nero-live" />
        <span className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-xs font-bold text-white/58">{metric}</span>
      </div>
      <h3 className="mt-8 text-3xl font-light leading-none">{title}</h3>
      <p className="mt-4 text-sm leading-6 text-white/58">{copy}</p>
    </article>
  );
}

function MetricTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.045] p-4 backdrop-blur-xl">
      <Icon className="h-4 w-4 text-nero-live" aria-hidden />
      <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-white/42">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function FocusRoom({
  state,
  participant,
  participantToken,
  currentTrack,
  isHost,
  onUnlockAudio,
  onFlash,
  onStateChange,
  onLeave,
}: {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  currentTrack: Track | null;
  isHost: boolean;
  onUnlockAudio: () => Promise<void>;
  onFlash: (flash: Flash) => void;
  onStateChange: (state: PartyState) => void;
  onLeave: () => void;
}) {
  const listenedTracks = useMemo(() => getListenedTracks(state), [state]);
  const [layer, setLayer] = useState<FocusLayer>(null);
  return (
    <div className="z-10 flex-1 py-4">
      <section className="grid min-h-0 gap-4">
        <NowPlayingStage
          state={state}
          participant={participant}
          participantToken={participantToken}
          currentTrack={currentTrack}
          isHost={isHost}
          onUnlockAudio={onUnlockAudio}
          onFlash={onFlash}
          onStateChange={onStateChange}
          onLeave={onLeave}
          onOpenSubmit={() => setLayer("submit")}
          onOpenRanking={() => setLayer("ranking")}
          onOpenQueue={() => setLayer("queue")}
          onOpenOverlay={() => setLayer("overlay")}
        />
      </section>

      {layer === "submit" ? (
        <ModalLayer title="Add a song" eyebrow="Audius or upload" onClose={() => setLayer(null)}>
          <SubmissionPanel state={state} participant={participant} participantToken={participantToken} onFlash={onFlash} modal onTrackAdded={() => setLayer(null)} />
        </ModalLayer>
      ) : null}

      {layer === "ranking" ? (
        <DrawerLayer title="Your Top 3" eyebrow="Private ranking" onClose={() => setLayer(null)}>
          <RankingBay state={state} participant={participant} participantToken={participantToken} tracks={listenedTracks} onFlash={onFlash} drawer />
        </DrawerLayer>
      ) : null}

      {layer === "queue" ? (
        <DrawerLayer title="Room queue" eyebrow="Shared playback" onClose={() => setLayer(null)}>
          <QueueRail state={state} drawer />
          <ParticipantRail state={state} drawer />
        </DrawerLayer>
      ) : null}

      {layer === "overlay" ? (
        <ModalLayer title="Overlay preview" eyebrow="Multitasking layer" onClose={() => setLayer(null)} variant="overlay">
          <div className="overlay-preview-modal">
            <CompanionRoom
              state={state}
              participant={participant}
              participantToken={participantToken}
              currentTrack={currentTrack}
              onFlash={onFlash}
              onExpand={() => setLayer(null)}
              surface="overlay"
            />
          </div>
        </ModalLayer>
      ) : null}
    </div>
  );
}

function NowPlayingStage({
  state,
  participant,
  participantToken,
  currentTrack,
  isHost,
  onUnlockAudio,
  onFlash,
  onStateChange,
  onLeave,
  onOpenSubmit,
  onOpenRanking,
  onOpenQueue,
  onOpenOverlay,
}: {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  currentTrack: Track | null;
  isHost: boolean;
  onUnlockAudio: () => Promise<void>;
  onFlash: (flash: Flash) => void;
  onStateChange: (state: PartyState) => void;
  onLeave: () => void;
  onOpenSubmit: () => void;
  onOpenRanking: () => void;
  onOpenQueue: () => void;
  onOpenOverlay: () => void;
}) {
  const progress = currentTrack ? Math.min(100, Math.round((state.playback.positionSeconds / currentTrack.durationSeconds) * 100)) : 0;
  const queuedPreview = state.tracks.find((track) => track.status === "queued") ?? null;
  const leadingWinner = state.winners[0] ?? null;
  const winnerTrack = leadingWinner ? state.tracks.find((track) => track.id === leadingWinner.trackId) ?? null : null;
  const isFinalized = state.party.status === "finalized";
  const heroTrack = currentTrack ?? (isFinalized ? winnerTrack : queuedPreview);
  const isPreview = Boolean(!currentTrack && queuedPreview);
  const waitingCount = state.tracks.filter((track) => track.status === "queued").length;
  const savedCount = state.savedTracks.filter((savedTrack) => savedTrack.participantId === participant.id).length;
  const ownQueued = state.tracks.find((track) => track.submittedByParticipantId === participant.id && track.status === "queued");
  const ownPosition = ownQueued ? Math.max(1, state.tracks.filter((track) => track.status === "queued" && track.queuePosition <= ownQueued.queuePosition).length) : null;
  const stageLabel = isFinalized ? "Final reveal" : currentTrack ? "Now playing" : isPreview ? "Up next" : "Lobby";
  const stageNote = isFinalized
    ? "Ballots are locked. The room winner is live."
    : currentTrack?.sourceType === "spotify"
      ? "Spotify is starting on each linked listener's active Spotify device."
      : currentTrack
      ? `Queued by ${currentTrack.submittedByName}`
      : queuedPreview
        ? `${waitingCount} waiting. Host can start when ready.`
        : "Add an Audius track, Spotify track, or approved upload to light up the room.";
  const participantRanking = getParticipantRanking(state, participant.id);
  const topTracks = participantRanking.map((trackId) => state.tracks.find((track) => track.id === trackId)).filter(Boolean) as Track[];
  const projectedWinners = getProjectedWinners(state);
  return (
    <div className="stage-shell live-stage overflow-hidden">
      <div className="stage-orbit" aria-hidden />
      <div className="stage-light-beams" aria-hidden />
      <div className="relative grid min-h-[calc(100dvh-4rem)] gap-6 p-4 sm:p-5 lg:p-7">
        <div className="stage-topline">
          <div className="min-w-0">
            <div className="live-context-pill">
              <span className="live-dot" />
              Live room
              <span>Web</span>
              <span>Overlay</span>
              <span>{state.party.code}</span>
            </div>
            <h2 className="mt-4 max-w-4xl truncate text-3xl font-light sm:text-5xl">{state.party.title}</h2>
            <p className="mt-2 truncate text-sm text-white/55">{stageNote}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button className="secondary-button" onClick={onOpenSubmit}>
              <Plus className="h-4 w-4" />
              Add song
            </button>
            <button className="secondary-button" onClick={onOpenQueue}>
              <ListMusic className="h-4 w-4" />
              Full queue
            </button>
            <button className="secondary-button" onClick={() => onOpenOverlay()}>
              <Minimize2 className="h-4 w-4" />
              Overlay
            </button>
            <SpotifyHeaderAction state={state} participantToken={participantToken} />
            <button className="icon-button" onClick={onLeave} title="Leave room" aria-label="Leave room">
              <DoorOpen className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="live-room-main">
          <QueuePreviewCard state={state} onOpenQueue={onOpenQueue} />

          <div className="now-playing-core">
            <TrackArtwork track={heroTrack} size="large" />
            <p className="mt-6 text-sm font-black uppercase tracking-[0.24em] text-nero-live/90">{stageLabel}</p>
            <h1 className="stage-title mt-3 max-w-5xl break-words text-center text-5xl font-light leading-none sm:text-7xl xl:text-8xl">
              {heroTrack?.title ?? "What belongs in your Top 3?"}
            </h1>
            <p className="mt-4 max-w-2xl text-center text-lg text-white/60 sm:text-2xl">
              {isFinalized && leadingWinner
                ? `${leadingWinner.score} points. ${leadingWinner.firstPlaceVotes} first-place vote${leadingWinner.firstPlaceVotes === 1 ? "" : "s"}.`
                : heroTrack?.artist ?? "Listen together, save what lands, and keep a private running ballot."}
            </p>

            <div className="mt-8 w-full max-w-3xl">
              <div className="waveform-progress" aria-hidden>
                {Array.from({ length: 72 }).map((_, index) => (
                  <span key={index} style={{ height: `${18 + ((index * 13) % 42)}%`, opacity: index / 72 <= progress / 100 ? 1 : 0.28 }} />
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-sm text-white/55">
                <span>{currentTrack ? formatTime(state.playback.positionSeconds) : "0:00"}</span>
                <span>{currentTrack ? formatTime(currentTrack.durationSeconds) : isPreview ? "Ready" : "Waiting"}</span>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {currentTrack ? (
                <QuickActions state={state} participant={participant} participantToken={participantToken} track={currentTrack} onFlash={onFlash} />
              ) : state.tracks.length === 0 ? (
                <button className="primary-button h-12 px-6" onClick={onOpenSubmit}>
                  <Plus className="h-4 w-4" />
                  Add first song
                </button>
              ) : (
                <button className="secondary-button h-12 px-5" onClick={onOpenSubmit}>
                  <Plus className="h-4 w-4" />
                  Add another
                </button>
              )}
            </div>

            {isHost ? (
              <div className="mt-5">
                <HostControls state={state} participantToken={participantToken} onFlash={onFlash} onStateChange={onStateChange} onPrimeAudio={onUnlockAudio} />
              </div>
            ) : null}
          </div>

          <div className="live-side-stack">
            <BallotPreview
              heroTrack={heroTrack}
              topTracks={topTracks}
              savedCount={savedCount}
              ownPosition={ownPosition}
              onOpenRanking={onOpenRanking}
            />
            <LeaderboardPreview state={state} projectedWinners={projectedWinners} />
          </div>
        </div>

        <Winners state={state} />
      </div>
    </div>
  );
}

function StatPuck({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-3">
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</p>
    </div>
  );
}

function TrackArtwork({ track, size }: { track: Track | null; size: "large" | "small" }) {
  const sizeClass = size === "large" ? "track-artwork-large" : "track-artwork-small";
  return (
    <div className={`track-artwork ${sizeClass}`}>
      {track?.artworkUrl ? (
        <img className="h-full w-full object-cover" src={track.artworkUrl} alt="" />
      ) : (
        <div className="track-artwork-empty">
          <Disc3 className={size === "large" ? "h-16 w-16" : "h-9 w-9"} />
        </div>
      )}
    </div>
  );
}

function QueuePreviewCard({ state, onOpenQueue }: { state: PartyState; onOpenQueue: () => void }) {
  const queued = state.tracks.filter((track) => track.status === "queued").slice(0, 6);
  const playing = state.tracks.find((track) => track.status === "playing");
  return (
    <aside className="stage-queue-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/42">Up next</p>
          <h3 className="mt-1 text-xl font-semibold">{queued.length} waiting</h3>
        </div>
        <button className="queue-top-button" onClick={onOpenQueue} title="See full queue" aria-label="See full queue">
          See all
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-4 grid gap-2">
        {playing ? <QueuePreviewRow track={playing} index="Live" live /> : null}
        {queued.map((track, index) => (
          <QueuePreviewRow key={track.id} track={track} index={String(index + 1)} />
        ))}
        {!playing && !queued.length ? (
          <button className="stage-queue-empty" onClick={onOpenQueue}>
            Queue is empty
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function QueuePreviewRow({ track, index, live = false }: { track: Track; index: string; live?: boolean }) {
  return (
    <div className={`queue-preview-row ${live ? "queue-preview-row-live" : ""}`}>
      <span>{index}</span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{track.title}</p>
        <p className="truncate text-xs text-white/45">{track.artist}</p>
      </div>
    </div>
  );
}

function ConditionsLauncherButton({ state, participant, onClick }: { state: PartyState; participant: Participant; onClick: () => void }) {
  const stats = getLimitStats(state, participant.id);
  const settings = state.party.settings;
  return (
    <button className="conditions-launcher" type="button" onClick={onClick}>
      <span className="conditions-launcher-topline">
        <span>
          <SlidersHorizontal className="h-4 w-4 text-nero-live" />
          Host conditions
        </span>
        <ChevronRight className="h-4 w-4 text-white/35" />
      </span>
      <span className="conditions-launcher-grid">
        <span>
          <strong>{stats.totalTracks}/{settings.maxQueueSize}</strong>
          <small>Songs</small>
        </span>
        <span>
          <strong>{formatDurationCompact(stats.totalSeconds)}/{settings.maxDurationMinutes}m</strong>
          <small>Time</small>
        </span>
        <span>
          <strong>{stats.participantTracks}/{settings.maxSubmissionsPerParticipant}</strong>
          <small>Yours</small>
        </span>
      </span>
    </button>
  );
}

function PartyConditionsPanel({ state, participant }: { state: PartyState; participant: Participant }) {
  const stats = getLimitStats(state, participant.id);
  const settings = state.party.settings;
  return (
    <section className="conditions-card">
      <div className="side-card-header">
        <div className="min-w-0">
          <p className="side-card-kicker">Host conditions</p>
          <h3>{state.party.status === "finalized" ? "Rules locked" : "Live room rules"}</h3>
        </div>
        <SlidersHorizontal className="h-5 w-5 text-nero-live" />
      </div>
      <div className="condition-stat-grid">
        <ConditionStat
          icon={ListMusic}
          label="Songs"
          value={`${stats.totalTracks}/${settings.maxQueueSize}`}
          percent={stats.songPercent}
        />
        <ConditionStat
          icon={Clock}
          label="Time"
          value={`${formatDurationCompact(stats.totalSeconds)}/${settings.maxDurationMinutes}m`}
          percent={stats.timePercent}
        />
        <ConditionStat
          icon={Ticket}
          label="Yours"
          value={`${stats.participantTracks}/${settings.maxSubmissionsPerParticipant}`}
          percent={stats.participantPercent}
        />
      </div>
      <div className="condition-source-row">
        {[
          { label: "Audius", active: settings.allowAudius },
          { label: "Upload", active: settings.allowUploads },
          { label: "Spotify", active: settings.allowSpotify },
        ].map((source) => (
          <span key={source.label} className={`condition-source-chip ${source.active ? "" : "condition-source-chip-off"}`}>
            {source.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function ConditionStat({
  icon: Icon,
  label,
  value,
  percent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  percent: number;
}) {
  return (
    <div className="condition-stat">
      <div className="flex items-center justify-between gap-2">
        <Icon className="h-4 w-4 text-nero-live" />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <div className="condition-meter" aria-hidden>
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function QuickActions({
  state,
  participant,
  participantToken,
  track,
  onFlash,
}: {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  track: Track;
  onFlash: (flash: Flash) => void;
}) {
  const participantRanking = getParticipantRanking(state, participant.id);
  const saved = state.savedTracks.some((savedTrack) => savedTrack.participantId === participant.id && savedTrack.trackId === track.id);
  const isTopPick = participantRanking[0] === track.id;

  return (
    <>
      <button
        className={`secondary-button ${saved ? "action-confirmed" : ""}`}
        onClick={() => saveTrack(participant.id, participantToken, track.id).then(() => onFlash({ tone: "good", message: "Saved to your party playlist." })).catch((error) => onFlash({ tone: "bad", message: getErrorMessage(error) }))}
      >
        <Heart className={`h-4 w-4 ${saved ? "fill-nero-live text-nero-live" : ""}`} />
        Save
      </button>
      <button
        className={`primary-button ${isTopPick ? "action-confirmed" : ""}`}
        onClick={() =>
          updateRanking(participant.id, participantToken, putTrackInTopThree(participantRanking, track.id))
            .then(() => onFlash({ tone: "good", message: "Moved into your Top 3." }))
            .catch((error) => onFlash({ tone: "bad", message: getErrorMessage(error) }))
        }
      >
        <Trophy className="h-4 w-4" />
        Put in Top 3
      </button>
    </>
  );
}

function SpotifyHeaderAction({ state, participantToken }: { state: PartyState; participantToken: string }) {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSpotifyStatus(state.party.id, participantToken)
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ configured: false, connected: false, displayName: null, spotifyUserId: null, expiresAt: null, scope: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [state.party.id, participantToken]);

  if (!status?.configured) return null;

  return (
    <a
      className={`spotify-header-button ${status.connected ? "spotify-header-button-connected" : ""}`}
      href={spotifyLoginUrl(state.party.id, participantToken)}
      title={status.connected ? `Spotify connected${status.displayName ? ` as ${status.displayName}` : ""}` : "Connect Spotify"}
    >
      <Disc3 className="h-4 w-4" />
      <span>{status.connected ? "Spotify connected" : "Connect Spotify"}</span>
    </a>
  );
}

function BallotPreview({
  heroTrack,
  topTracks,
  savedCount,
  ownPosition,
  onOpenRanking,
}: {
  heroTrack: Track | null;
  topTracks: Track[];
  savedCount: number;
  ownPosition: number | null;
  onOpenRanking: () => void;
}) {
  return (
    <section className="ballot-preview-card ballot-preview-rich">
      <div className="side-card-header">
        <div className="min-w-0">
          <p className="side-card-kicker">Your Top 3</p>
          <h3>Current ballot</h3>
          <p className="side-card-copy">
            {ownPosition ? `You're ${ordinal(ownPosition)} in queue.` : savedCount ? `${savedCount} saved track${savedCount === 1 ? "" : "s"} so far.` : "Tap any slot to edit your ballot."}
          </p>
        </div>
        <button className="side-card-open" onClick={onOpenRanking}>
          Edit
        </button>
      </div>
      <div className="ballot-art-row">
        <TrackArtwork track={heroTrack} size="small" />
        <div className="ballot-status-card">
          <Trophy className="h-4 w-4 text-nero-live" />
          <strong>{topTracks.length}/3 locked</strong>
        </div>
      </div>
      <div className="ballot-rank-list">
        {[0, 1, 2].map((index) => {
          const track = topTracks[index];
          return (
            <button key={track?.id ?? `side-empty-${index}`} className="ballot-rank-row" onClick={onOpenRanking}>
              <span>{index + 1}</span>
              <div className="min-w-0">
                <strong>{track?.title ?? "Open slot"}</strong>
              </div>
              <em>Edit</em>
              <ChevronRight className="h-4 w-4 text-white/35" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function LeaderboardPreview({ state, projectedWinners }: { state: PartyState; projectedWinners: ReturnType<typeof getProjectedWinners> }) {
  const leaders = state.party.status === "finalized" ? state.winners.slice(0, 3) : projectedWinners.slice(0, 3);
  const ballotCount =
    state.party.status === "finalized"
      ? new Set(state.ranking.map((entry) => entry.participantId)).size
      : new Set(state.ranking.filter((entry) => entry.rank <= 3).map((entry) => entry.participantId)).size;

  return (
    <section className="leaderboard-card leaderboard-card-rich">
      <div className="side-card-header">
        <div className="min-w-0">
          <p className="side-card-kicker">Leaderboard</p>
          <h3>{leaders[0]?.title ?? "Finale proof"}</h3>
        </div>
        <div className="leaderboard-icon">
          <Trophy className="h-5 w-5" />
        </div>
      </div>
      <div className="leaderboard-meta">
        <span>{ballotCount} ballots</span>
        <span>5 / 3 / 1</span>
      </div>
      <div className="leaderboard-meter" aria-hidden>
        <span style={{ width: `${Math.min(100, ballotCount * 18)}%` }} />
      </div>
      <div className="mt-3 grid gap-2">
        {leaders.length ? (
          leaders.map((leader, index) => (
            <div key={leader.trackId} className="leaderboard-row">
              <span>{index + 1}</span>
              <strong>{leader.title}</strong>
              <small>{leader.score} pts</small>
            </div>
          ))
        ) : (
          <div className="leaderboard-empty">
            <Trophy className="h-5 w-5 text-nero-live" />
            <span>Top 3 picks appear here as people rank songs.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function HostControls({
  state,
  participantToken,
  onFlash,
  onStateChange,
  onPrimeAudio,
}: {
  state: PartyState;
  participantToken: string;
  onFlash: (flash: Flash) => void;
  onStateChange: (state: PartyState) => void;
  onPrimeAudio: () => Promise<void>;
}) {
  const [busyAction, setBusyAction] = useState<"start" | "advance" | "finale" | null>(null);
  const queuedCount = state.tracks.filter((track) => track.status === "queued").length;
  const hasCurrentTrack = Boolean(state.playback.currentTrackId);
  const canStart = queuedCount > 0 && !hasCurrentTrack && state.party.status !== "finalized";
  const canAdvance = state.party.status !== "finalized" && (hasCurrentTrack || queuedCount > 0);
  const canFinalize = state.party.status !== "finalized";

  const common = async (action: "start" | "advance" | "finale", run: () => Promise<{ state: PartyState }>, message: string) => {
    if (busyAction) return;
    setBusyAction(action);
    try {
      void onPrimeAudio();
      const result = await run();
      onStateChange(result.state);
      onFlash({ tone: "good", message });
    } catch (error) {
      onFlash({ tone: "bad", message: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="host-strip">
      <span className="host-strip-label">Host controls</span>
      <div className="host-strip-actions">
        <button className="primary-button" disabled={!canStart || Boolean(busyAction)} onClick={() => void common("start", () => startPlayback(state.party.id, participantToken), "Playback started.")}>
          {busyAction === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {busyAction === "start" ? "Starting" : "Start"}
        </button>
        <button className="secondary-button" disabled={!canAdvance || Boolean(busyAction)} onClick={() => void common("advance", () => advancePlayback(state.party.id, participantToken), "Advanced queue.")}>
          {busyAction === "advance" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
          {busyAction === "advance" ? "Advancing" : "Advance"}
        </button>
        <button className="secondary-button" disabled={!canFinalize || Boolean(busyAction)} onClick={() => void common("finale", () => finalizeParty(state.party.id, participantToken), "Final ballot locked.")}>
          {busyAction === "finale" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
          {busyAction === "finale" ? "Locking" : "Finale"}
        </button>
      </div>
    </div>
  );
}

function ModalLayer({
  title,
  eyebrow,
  children,
  onClose,
  variant = "default",
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  onClose: () => void;
  variant?: "default" | "overlay";
}) {
  return (
    <div className="app-layer-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`app-modal ${variant === "overlay" ? "app-modal-overlay" : ""}`}>
        <div className="layer-header">
          <div>
            <p>{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmLeaveModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="app-layer-backdrop" role="dialog" aria-modal="true" aria-label="Leave room">
      <div className="confirm-modal">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-black">
          <DoorOpen className="h-5 w-5" />
        </div>
        <p className="mt-5 text-xs font-black uppercase tracking-[0.22em] text-nero-live">Leave room</p>
        <h2 className="mt-2 text-3xl font-light leading-none">Leave this listening party?</h2>
        <p className="mt-3 text-sm leading-6 text-white/58">Your saved tracks and Top 3 stay in the room, but this browser will forget its participant token.</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button className="secondary-button" onClick={onCancel}>
            Stay
          </button>
          <button className="primary-button" onClick={onConfirm}>
            Leave room
          </button>
        </div>
      </div>
    </div>
  );
}

function DrawerLayer({ title, eyebrow, children, onClose }: { title: string; eyebrow: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="app-layer-backdrop app-layer-drawer-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <aside className="app-drawer">
        <div className="drawer-body">
          <div className="layer-header drawer-visible-header">
            <div>
              <p>{eyebrow}</p>
              <h2>{title}</h2>
            </div>
            <button className="icon-button" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          {children}
        </div>
      </aside>
    </div>
  );
}

function CompanionRoom({
  state,
  participant,
  participantToken,
  currentTrack,
  onFlash,
  onExpand,
  surface = "web",
}: {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  currentTrack: Track | null;
  onFlash: (flash: Flash) => void;
  onExpand: () => void;
  surface?: Surface;
}) {
  const listenedTracks = useMemo(() => getListenedTracks(state), [state]);
  const [rankingOpen, setRankingOpen] = useState(false);
  const topTracks = getParticipantRanking(state, participant.id).map((trackId) => state.tracks.find((track) => track.id === trackId)).filter(Boolean) as Track[];
  const isOverlay = surface === "overlay";
  return (
    <section className={`companion-stage z-10 mx-auto flex w-full flex-1 items-center justify-center py-5 ${isOverlay ? "companion-stage-overlay max-w-[620px]" : "max-w-[760px]"}`}>
      <div className="companion-context" aria-hidden />
      <div className="companion-shell companion-window w-full">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-nero-live text-nero-ink">
              <AudioLines className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.22em] text-nero-live">{isOverlay ? "Overlay panel" : "Companion mode"}</p>
              <h2 className="truncate text-lg font-semibold">{state.party.title}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isOverlay ? (
              <button className="tiny-button h-8 w-8" title="Collapse preview" aria-label="Collapse preview">
                <Minimize2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button className="icon-button" onClick={onExpand} title="Open Focus Mode" aria-label="Open Focus Mode">
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid gap-5 p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-[120px_minmax(0,1fr)]">
            <TrackArtwork track={currentTrack} size="small" />
            <div className="min-w-0 self-center">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-nero-live/10 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-nero-live">
                <span className="h-1.5 w-1.5 rounded-full bg-nero-live" />
                Now playing
              </div>
              <h3 className={`truncate font-light leading-none ${isOverlay ? "text-3xl" : "text-4xl"}`}>{currentTrack?.title ?? "Queue is waiting"}</h3>
              <p className="mt-2 truncate text-base text-nero-mist">{currentTrack?.artist ?? "No track playing"}</p>
            </div>
          </div>

          {currentTrack ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <QuickActions state={state} participant={participant} participantToken={participantToken} track={currentTrack} onFlash={onFlash} />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.035] px-4 py-5 text-sm text-white/55">
              Start playback in Focus Mode or wait for the host.
            </div>
          )}

          <div className="remote-top3-card">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-nero-live">My Top 3</p>
              <button className="tiny-button h-8 w-8" onClick={() => setRankingOpen(true)} title="Edit Top 3" aria-label="Edit Top 3">
                <Trophy className="h-4 w-4 text-nero-live" />
              </button>
            </div>
            <div className="grid gap-2">
              {[0, 1, 2].map((index) => {
                const track = topTracks[index];
                return (
                  <button key={track?.id ?? `companion-empty-${index}`} className="remote-rank-row" onClick={() => setRankingOpen(true)}>
                    <span>{index + 1}</span>
                    <strong>{track?.title ?? "Open slot"}</strong>
                  </button>
                );
              })}
            </div>
          </div>

          {!isOverlay ? (
            <div className="companion-history-strip">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white/38">Full ballot</p>
                <p className="truncate text-sm text-white/60">
                  {listenedTracks.length ? `${listenedTracks.length} listened tracks can be moved in.` : "Listened songs land here once the party starts."}
                </p>
              </div>
              <button className="secondary-button" onClick={() => setRankingOpen(true)}>
                <PanelRightOpen className="h-4 w-4" />
                Edit
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="companion-mini-bar">
        <Music2 className="h-4 w-4 text-nero-live" />
        <span className="truncate">{currentTrack?.title ?? (isOverlay ? "Nero Party overlay" : "Nero Party companion")}</span>
        <AudioLines className="h-4 w-4 text-nero-live" />
      </div>
      {rankingOpen ? (
        <DrawerLayer title="Your Top 3" eyebrow="Private ranking" onClose={() => setRankingOpen(false)}>
          <RankingBay state={state} participant={participant} participantToken={participantToken} tracks={listenedTracks} onFlash={onFlash} drawer />
        </DrawerLayer>
      ) : null}
    </section>
  );
}

function RankingBay({
  state,
  participant,
  participantToken,
  tracks,
  onFlash,
  compact = false,
  drawer = false,
}: {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  tracks: Track[];
  onFlash: (flash: Flash) => void;
  compact?: boolean;
  drawer?: boolean;
}) {
  const rankingIds = getParticipantRanking(state, participant.id);
  const rankedTracks = rankingIds.map((trackId) => state.tracks.find((track) => track.id === trackId)).filter(Boolean) as Track[];
  const [draggingId, setDraggingId] = useState<string | null>(null);

  async function commit(nextIds: string[], message = "Top 3 updated.") {
    try {
      await updateRanking(participant.id, participantToken, nextIds);
      onFlash({ tone: "good", message });
    } catch (error) {
      onFlash({ tone: "bad", message: getErrorMessage(error) });
    }
  }

  function move(trackId: string, offset: number) {
    const ids = [...rankingIds];
    const index = ids.indexOf(trackId);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex > ids.length - 1) return;
    ids.splice(index, 1);
    ids.splice(nextIndex, 0, trackId);
    void commit(ids);
  }

  return (
    <section className={`${drawer ? "drawer-section" : "room-panel"} ${compact ? "p-3" : "ballot-dock p-4"}`}>
      <div className={`flex items-center justify-between gap-3 ${compact ? "" : "ballot-header"}`}>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-nero-live">Your ballot</p>
          <h3 className={`${compact ? "text-lg" : "text-xl"} font-semibold`}>Your current Top 3</h3>
        </div>
        <Trophy className="h-5 w-5 text-nero-live" aria-hidden />
      </div>

      <div className={`mt-4 grid gap-2 ${compact || drawer ? "" : "md:grid-cols-3"}`}>
        {[0, 1, 2].map((index) => {
          const track = rankedTracks[index];
          return (
            <div
              key={track?.id ?? `empty-${index}`}
              draggable={Boolean(track)}
              onDragStart={() => setDraggingId(track?.id ?? null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (!draggingId || !track) return;
                const ids = [...rankingIds];
                const from = ids.indexOf(draggingId);
                const to = ids.indexOf(track.id);
                if (from < 0 || to < 0) return;
                ids.splice(from, 1);
                ids.splice(to, 0, draggingId);
                void commit(ids);
              }}
              className={`ranking-row ${compact ? "" : "ranking-row-dock"}`}
            >
              <div className="grid h-9 w-9 place-items-center rounded-md bg-nero-live text-sm font-black text-nero-ink">{index + 1}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{track?.title ?? "Open slot"}</p>
                <p className="truncate text-xs text-nero-mist">{track?.artist ?? "Tap a listened song below"}</p>
              </div>
              {track ? (
                <div className="flex items-center gap-1">
                  <button className="tiny-button" onClick={() => move(track.id, -1)} title="Move up" aria-label="Move up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button className="tiny-button" onClick={() => move(track.id, 1)} title="Move down" aria-label="Move down">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <GripVertical className="h-4 w-4 text-white/30" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className={`${compact ? "mt-4 max-h-52 overflow-y-auto pr-1" : "mt-3"}`}>
        <div className="grid gap-2">
          {tracks.length ? (
            tracks.map((track) => (
              <button
                key={track.id}
                className="history-row"
                onClick={() => commit(putTrackInTopThree(rankingIds, track.id), "Moved into your Top 3.")}
              >
                <span className="min-w-0 text-left">
                  <span className="block truncate text-sm font-semibold">{track.title}</span>
                  <span className="block truncate text-xs text-nero-mist">{track.artist}</span>
                </span>
                <Plus className="h-4 w-4 text-nero-live" />
              </button>
            ))
          ) : (
            <div className={`rounded-md border border-dashed border-white/15 px-3 text-sm text-nero-mist ${compact ? "py-4" : "py-3"}`}>Listened songs land here.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function QueueRail({ state, drawer = false }: { state: PartyState; drawer?: boolean }) {
  const upcoming = state.tracks.filter((track) => track.status === "queued");
  const playedCount = state.tracks.filter((track) => track.status === "played").length;
  return (
    <section className={`${drawer ? "drawer-section" : "room-panel"} flex min-h-0 flex-col p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-nero-live">Room queue</p>
          <h3 className="text-xl font-semibold">{upcoming.length} in Queue</h3>
        </div>
        <ListMusic className="h-5 w-5 text-nero-live" aria-hidden />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <StatPuck value={upcoming.length} label="Queue" />
        <StatPuck value={playedCount} label="Played" />
        <StatPuck value={state.participants.length} label="People" />
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-2">
          {state.tracks.map((track) => (
            <div key={track.id} className={`queue-row ${track.status === "playing" ? "queue-row-live" : ""}`}>
              <span className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 text-xs font-bold text-white/60">{track.queuePosition}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{track.title}</p>
                <p className="truncate text-xs text-nero-mist">{track.submittedByName} · {track.artist}</p>
              </div>
              <span className="rounded-full bg-white/[0.05] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">{track.status}</span>
            </div>
          ))}
          {!state.tracks.length ? <div className="rail-empty">No tracks yet.</div> : null}
        </div>
      </div>
    </section>
  );
}

function ParticipantRail({ state, drawer = false }: { state: PartyState; drawer?: boolean }) {
  return (
    <section className={`${drawer ? "drawer-section" : "room-panel"} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-nero-live">Community</p>
          <h3 className="text-xl font-semibold">{state.participants.length} watching</h3>
        </div>
        <Users className="h-5 w-5 text-nero-live" aria-hidden />
      </div>
      <div className="mt-4 grid gap-2">
        {state.participants.map((participant) => (
          <div key={participant.id} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{participant.displayName}</p>
              <p className="text-xs text-nero-mist">{participant.source}</p>
            </div>
            <div className="flex items-center gap-2">
              {participant.role === "host" ? <Crown className="h-4 w-4 text-nero-live" /> : null}
              <span className={`h-2 w-2 rounded-full ${participant.audioReady ? "bg-nero-live" : "bg-white/25"}`} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SubmissionPanel({
  state,
  participant,
  participantToken,
  onFlash,
  modal = false,
  onTrackAdded,
}: {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  onFlash: (flash: Flash) => void;
  modal?: boolean;
  onTrackAdded?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadArtist, setUploadArtist] = useState("");
  const [uploadFileName, setUploadFileName] = useState("");
  const [sourceTab, setSourceTab] = useState<"spotify" | "audius" | "upload">("audius");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const settings = state.party.settings;
  const sourceAllowed = {
    audius: settings.allowAudius,
    upload: settings.allowUploads,
    spotify: settings.allowSpotify,
  };
  const limitStats = getLimitStats(state, participant.id);
  const ownQueued = state.tracks.find((track) => track.submittedByParticipantId === participant.id && track.status === "queued");
  const ownPosition = ownQueued ? Math.max(1, state.tracks.filter((track) => track.status === "queued" && track.queuePosition <= ownQueued.queuePosition).length) : null;
  const remainingTracks = Math.max(0, settings.maxQueueSize - limitStats.totalTracks);
  const remainingSeconds = Math.max(0, settings.maxDurationMinutes * 60 - limitStats.totalSeconds);
  const remainingSubmissions = Math.max(0, settings.maxSubmissionsPerParticipant - limitStats.participantTracks);

  useEffect(() => {
    setResults([]);
  }, [sourceTab]);

  useEffect(() => {
    if (sourceAllowed[sourceTab]) return;
    const fallback = sourceAllowed.audius ? "audius" : sourceAllowed.upload ? "upload" : "spotify";
    setSourceTab(fallback);
  }, [sourceAllowed.audius, sourceAllowed.spotify, sourceAllowed.upload, sourceTab]);

  function submissionBlocker(durationSeconds = 1) {
    if (remainingSubmissions <= 0) return "You have used all submissions for this room.";
    if (remainingTracks <= 0) return "The room song limit is full.";
    if (remainingSeconds <= 0) return "The room time limit is full.";
    if (durationSeconds > remainingSeconds) return `This track is longer than the ${formatDurationCompact(remainingSeconds)} remaining timebox.`;
    return null;
  }

  async function runSearch() {
    if (query.trim().length < 2) return;
    if (!sourceAllowed[sourceTab]) {
      onFlash({ tone: "warn", message: `${sourceTab} submissions are disabled for this room.` });
      return;
    }
    setLoading(true);
    try {
      const payload = sourceTab === "spotify" ? await searchSpotify(query) : await searchAudius(query);
      setResults(payload.results);
    } catch (error) {
      onFlash({ tone: "bad", message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }

  async function addSearchTrack(track: SearchTrack) {
    const blocker = submissionBlocker(track.durationSeconds);
    if (blocker) {
      onFlash({ tone: "warn", message: blocker });
      return;
    }
    try {
      await addTrack(state.party.id, { ...track, participantToken });
      onFlash({ tone: "good", message: "Track added to the room." });
      onTrackAdded?.();
    } catch (error) {
      onFlash({ tone: "bad", message: getErrorMessage(error) });
    }
  }

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      onFlash({ tone: "warn", message: "Choose an audio file first." });
      return;
    }
    const blocker = submissionBlocker();
    if (blocker) {
      onFlash({ tone: "warn", message: blocker });
      return;
    }
    const formData = new FormData();
    formData.set("audio", file);
    if (uploadTitle) formData.set("title", uploadTitle);
    if (uploadArtist) formData.set("artist", uploadArtist);
    setUploading(true);
    try {
      const uploaded = await uploadAudio(formData);
      await addTrack(state.party.id, { ...uploaded, participantToken });
      onFlash({ tone: "good", message: "Upload added to the room." });
      setUploadTitle("");
      setUploadArtist("");
      setUploadFileName("");
      if (fileRef.current) fileRef.current.value = "";
      onTrackAdded?.();
    } catch (error) {
      onFlash({ tone: "bad", message: getErrorMessage(error) });
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className={`${modal ? "submit-modal-surface" : "room-panel"} flex min-h-0 flex-col p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-nero-live">Submit</p>
          <h3 className="text-xl font-semibold">Add a song</h3>
        </div>
        <Music2 className="h-5 w-5 text-nero-live" aria-hidden />
      </div>

      <div className="queue-status-card mt-4">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-black">
          <Ticket className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{ownQueued ? ownQueued.title : `${remainingSubmissions} submission${remainingSubmissions === 1 ? "" : "s"} left for you`}</p>
          <p className="truncate text-xs text-white/50">
            {ownPosition
              ? `You're ${ordinal(ownPosition)} in queue.`
              : `${remainingTracks} room slot${remainingTracks === 1 ? "" : "s"} · ${formatDurationCompact(remainingSeconds)} left.`}
          </p>
        </div>
      </div>
      <div className="condition-mini-grid">
        <ConditionStat icon={ListMusic} label="Songs" value={`${limitStats.totalTracks}/${settings.maxQueueSize}`} percent={limitStats.songPercent} />
        <ConditionStat icon={Clock} label="Time" value={`${formatDurationCompact(limitStats.totalSeconds)}/${settings.maxDurationMinutes}m`} percent={limitStats.timePercent} />
      </div>

      <div className="source-switch mt-4">
        <button
          className={sourceTab === "audius" ? "source-switch-active" : ""}
          onClick={() => setSourceTab("audius")}
          type="button"
          disabled={!sourceAllowed.audius}
        >
          <Search className="h-4 w-4" />
          Audius
        </button>
        <button
          className={sourceTab === "upload" ? "source-switch-active" : ""}
          onClick={() => setSourceTab("upload")}
          type="button"
          disabled={!sourceAllowed.upload}
        >
          <Upload className="h-4 w-4" />
          Upload
        </button>
        <button
          className={sourceTab === "spotify" ? "source-switch-active" : ""}
          onClick={() => setSourceTab("spotify")}
          type="button"
          disabled={!sourceAllowed.spotify}
        >
          <Disc3 className="h-4 w-4" />
          Spotify
        </button>
      </div>

      {sourceTab === "spotify" || sourceTab === "audius" ? (
        <div className="mt-4 grid gap-3">
          <div className="flex gap-2">
            <input
              className="field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={sourceTab === "spotify" ? "Search Spotify" : "Search Audius"}
            />
            <button
              className="icon-button h-11 w-11"
              onClick={runSearch}
              disabled={loading}
              title={sourceTab === "spotify" ? "Search Spotify" : "Search Audius"}
              aria-label={sourceTab === "spotify" ? "Search Spotify" : "Search Audius"}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto pr-1">
            <div className="grid gap-2">
              {results.map((track) => {
                const blocker = submissionBlocker(track.durationSeconds);
                return (
                  <button
                    key={track.sourceId}
                    className="history-row"
                    onClick={() => addSearchTrack(track)}
                    disabled={Boolean(blocker)}
                    title={blocker ?? `Add ${track.title}`}
                  >
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-sm font-semibold">{track.title}</span>
                      <span className="block truncate text-xs text-nero-mist">{track.artist} · {formatDurationCompact(track.durationSeconds)}</span>
                    </span>
                    {track.sourceType === "spotify" ? <Disc3 className="h-4 w-4 text-nero-live" /> : <Plus className="h-4 w-4 text-nero-live" />}
                  </button>
                );
              })}
              {!results.length ? (
                <div className="source-empty-state">
                  {sourceTab === "spotify"
                    ? "Search Spotify to play the same track on every linked listener device."
                    : "Search Audius to add a full song to the room queue."}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <button className="upload-dropzone" type="button" onClick={() => fileRef.current?.click()}>
            <input
              ref={fileRef}
              className="sr-only"
              type="file"
              accept="audio/*"
              onChange={(event) => setUploadFileName(event.target.files?.[0]?.name ?? "")}
            />
            <Upload className="h-6 w-6 text-nero-live" />
            <span>{uploadFileName || "Drag in an audio file, or choose MP3 / WAV"}</span>
            <small>Only upload music you have permission to share in the room.</small>
          </button>
          <input className="field" value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="Upload title" />
          <input className="field" value={uploadArtist} onChange={(event) => setUploadArtist(event.target.value)} placeholder="Artist" />
          <button className="primary-button h-11 justify-center" onClick={handleUpload} disabled={uploading || Boolean(submissionBlocker())}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Add upload
          </button>
        </div>
      )}

      <div className="source-policy-note">
        <Shield className="h-4 w-4 text-nero-live" />
        <span>Uploads and Audius play in browser. Spotify requires each listener to connect their own account/device; Nero does not rebroadcast Spotify audio.</span>
      </div>
    </section>
  );
}

function Winners({ state }: { state: PartyState }) {
  if (state.party.status !== "finalized") return null;
  const winner = state.winners[0] ?? null;
  const winnerTrack = winner ? state.tracks.find((track) => track.id === winner.trackId) ?? null : null;
  const totalBallots = new Set(state.ranking.map((entry) => entry.participantId)).size;
  return (
    <div className="finale-stage">
      <div className="finale-rays" aria-hidden />
      <div className="relative z-10 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.24em] text-nero-live">Final reveal</p>
          <h2 className="mt-2 text-4xl font-light leading-none sm:text-6xl">
            {winner ? "The room picked a winner." : "Ballots are locked."}
          </h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-white/60">
            Final ballots use each listener's current Top 3. Scoring is 5 / 3 / 1 with tie-breaks by first-place votes, appearances, then earlier queue position.
          </p>
          <div className="finale-score-note justify-start">
            <span>{totalBallots} ballot{totalBallots === 1 ? "" : "s"} counted</span>
            <span>{state.tracks.length} tracks heard</span>
            <span>Playlist export ready</span>
          </div>
        </div>

        {winner ? (
          <div className="finale-winner-card">
            <span className="finale-rank finale-rank-xl">1</span>
            <TrackArtwork track={winnerTrack} size="small" />
            <div className="min-w-0">
              <p className="truncate text-3xl font-light">{winner.title}</p>
              <p className="mt-1 truncate text-sm text-white/55">{winner.artist} · submitted by {winner.submittedByName}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-[0.14em] text-white/55">
                <span className="finale-stat">{winner.score} points</span>
                <span className="finale-stat">{winner.firstPlaceVotes} first-place</span>
                <span className="finale-stat">{winner.appearances} appearance{winner.appearances === 1 ? "" : "s"}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {state.winners.length ? (
        <div className="finale-podium">
          {state.winners.slice(0, 3).map((nextWinner, index) => {
            const rankClass = index === 0 ? "finale-card-1" : index === 1 ? "finale-card-2" : "finale-card-3";
            return (
              <div key={nextWinner.trackId} className={`finale-card ${rankClass}`}>
                <span className="finale-rank">{index + 1}</span>
                <TrackArtwork track={state.tracks.find((track) => track.id === nextWinner.trackId) ?? null} size="small" />
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{nextWinner.title}</p>
                  <p className="truncate text-sm text-white/55">{nextWinner.artist}</p>
                </div>
                <strong>{nextWinner.score}</strong>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="source-empty-state mt-6">No Top 3 ballots were submitted before finale.</div>
      )}
    </div>
  );
}

function getProjectedWinners(state: PartyState) {
  const grouped = new Map<string, Ballot["ranks"]>();
  state.ranking.forEach((entry) => {
    if (entry.rank > 3) return;
    const ranks = grouped.get(entry.participantId) ?? [];
    ranks.push({ trackId: entry.trackId, rank: entry.rank });
    grouped.set(entry.participantId, ranks);
  });

  const ballots: Ballot[] = [...grouped.entries()]
    .filter(([, ranks]) => ranks.length)
    .map(([participantId, ranks]) => ({
      participantId,
      ranks: ranks.sort((left, right) => left.rank - right.rank).slice(0, 3),
      submittedAt: new Date().toISOString(),
    }));

  return scoreBallots(state.tracks, ballots);
}

function MiniSignal({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
      <Icon className="h-4 w-4 text-nero-live" aria-hidden />
      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-white/45">{label}</p>
      <p className="mt-1 truncate text-sm font-bold">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <span className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">{label}</span>
      {children}
    </div>
  );
}

function FlashBanner({ flash, onDismiss }: { flash: NonNullable<Flash>; onDismiss: () => void }) {
  const color = flash.tone === "good" ? "border-nero-live/40 bg-nero-live/10 text-nero-live" : flash.tone === "warn" ? "border-nero-warning/40 bg-nero-warning/10 text-nero-warning" : "border-red-400/40 bg-red-500/10 text-red-200";
  return (
    <div className={`z-20 mt-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm font-semibold ${color}`}>
      <span>{flash.message}</span>
      <button className="rounded p-1 hover:bg-white/10" onClick={onDismiss} aria-label="Dismiss message">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function getParticipantRanking(state: PartyState, participantId: string) {
  return state.ranking
    .filter((entry) => entry.participantId === participantId)
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.trackId);
}

function getListenedTracks(state: PartyState) {
  return state.tracks.filter((track) => track.status === "played" || track.status === "playing").sort((a, b) => b.queuePosition - a.queuePosition);
}

function getLimitStats(state: PartyState, participantId: string) {
  const totalTracks = state.tracks.length;
  const totalSeconds = state.tracks.reduce((sum, track) => sum + track.durationSeconds, 0);
  const participantTracks = state.tracks.filter((track) => track.submittedByParticipantId === participantId).length;
  const maxSeconds = state.party.settings.maxDurationMinutes * 60;
  return {
    totalTracks,
    totalSeconds,
    participantTracks,
    songPercent: clampPercent((totalTracks / state.party.settings.maxQueueSize) * 100),
    timePercent: clampPercent((totalSeconds / maxSeconds) * 100),
    participantPercent: clampPercent((participantTracks / state.party.settings.maxSubmissionsPerParticipant) * 100),
  };
}

function formatEnabledSources(settings: PartySettings) {
  const sources = [
    settings.allowAudius ? "Audius" : null,
    settings.allowUploads ? "Uploads" : null,
    settings.allowSpotify ? "Spotify" : null,
  ].filter(Boolean);
  return sources.join(" + ");
}

function formatDurationCompact(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  if (minutes > 0) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  return `${rest}s`;
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.max(0, Math.floor(seconds % 60));
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function ordinal(value: number) {
  const suffix = value % 10 === 1 && value % 100 !== 11 ? "st" : value % 10 === 2 && value % 100 !== 12 ? "nd" : value % 10 === 3 && value % 100 !== 13 ? "rd" : "th";
  return `${value}${suffix}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function tokenKey(code: string) {
  return `nero-party-token-${code.toUpperCase()}`;
}

function storeSession(code: string, token: string) {
  localStorage.setItem(tokenKey(code), token);
}

function parseRoute(): { code: string; surface: Surface } {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(window.location.search);
  if (parts[0] === "discord") return { code: (parts[1] ?? params.get("code") ?? "").toUpperCase(), surface: "web" };
  if (parts[0] === "companion") return { code: (parts[1] ?? params.get("code") ?? "").toUpperCase(), surface: "overlay" };
  if (parts[0] === "party") return { code: (parts[1] ?? params.get("code") ?? "").toUpperCase(), surface: "web" };
  return { code: (params.get("code") ?? "").toUpperCase(), surface: params.get("source") === "overlay" ? "overlay" : "web" };
}

export default App;
