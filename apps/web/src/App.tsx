import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  ChevronRight,
  Clock,
  Copy,
  Crown,
  Disc3,
  Download,
  DoorOpen,
  GripVertical,
  Heart,
  ListMusic,
  Loader2,
  type LucideIcon,
  Maximize2,
  Minimize2,
  Music2,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  Search,
  Shield,
  SlidersHorizontal,
  SkipForward,
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
  getSpotifyWebToken,
  getParty,
  joinParty,
  pausePlayback,
  saveTrack,
  searchAudius,
  searchSpotify,
  setSpotifyDevice,
  startPlayback,
  spotifyLoginUrl,
  updateRanking,
  uploadAudio,
  type SearchTrack,
  type SpotifyStatus,
} from "./lib/api";
import { socket } from "./lib/socket";

type Surface = "web" | "overlay";
type FocusLayer = "submit" | "ranking" | "queue" | "saved" | "overlay" | null;
type Flash = { tone: "good" | "warn" | "bad"; message: string } | null;
type LeaveIntent = "room" | null;
type SpotifyWebPlaybackState = "idle" | "starting" | "ready" | "unavailable";

interface SpotifyWebPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: "ready", callback: (payload: { device_id: string }) => void): boolean;
  addListener(event: "not_ready", callback: (payload: { device_id: string }) => void): boolean;
  addListener(event: "initialization_error" | "authentication_error" | "account_error" | "playback_error", callback: (payload: { message: string }) => void): boolean;
}

declare global {
  interface Window {
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (callback: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyWebPlayer;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

const route = parseRoute();
const SILENT_AUDIO_DATA_URL =
  "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
let spotifySdkPromise: Promise<void> | null = null;

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
    const primeAudio = (event: PointerEvent | KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-host-controls]")) return;
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
      setAudioPosition(audio, targetPosition, currentTrack.durationSeconds);
    }
    if (state.playback.isPlaying) {
      void audio.play().catch(() => {
        setAudioUnlocked(false);
        socket.emit("audio:ready", { participantToken, audioReady: false });
        setFlash({ tone: "warn", message: "Browser blocked audio. Click anywhere in the room to resume playback." });
      });
      window.setTimeout(() => {
        if (audio.paused) {
          setAudioUnlocked(false);
          socket.emit("audio:ready", { participantToken, audioReady: false });
        }
      }, 1000);
    } else {
      audio.pause();
    }
  }, [audioUnlocked, currentTrack, participantToken, state?.playback.currentTrackId, state?.playback.isPlaying, state?.playback.positionSeconds]);

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
      window.scrollTo({ top: 0, left: 0 });
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
      window.scrollTo({ top: 0, left: 0 });
    } catch (error) {
      setFlash({ tone: "bad", message: getErrorMessage(error) });
    } finally {
      setIsJoining(false);
    }
  }

  async function unlockAudio(trackToPrime?: Track | null) {
    const audio = audioRef.current;
    if (!audio) return false;
    if (audioUnlocked && trackToPrime === undefined) return true;

    let unlocked = false;
    try {
      audio.muted = false;
      const trackForAudio = trackToPrime ?? (state?.playback.isPlaying ? currentTrack : null);
      if (trackForAudio?.streamUrl) {
        if (!audio.src.includes(trackForAudio.streamUrl)) {
          audio.src = trackForAudio.streamUrl;
          audio.load();
        }
        const positionSeconds = trackForAudio.id === currentTrack?.id ? (state?.playback.positionSeconds ?? 0) : 0;
        setAudioPosition(audio, positionSeconds, trackForAudio.durationSeconds);
        void audio.play().catch(() => {
          setAudioUnlocked(false);
          socket.emit("audio:ready", { participantToken, audioReady: false });
          setFlash({ tone: "warn", message: "Browser blocked audio. Press Play again to resume playback." });
        });
        window.setTimeout(() => {
          if (audio.paused) {
            setAudioUnlocked(false);
            socket.emit("audio:ready", { participantToken, audioReady: false });
            setFlash({ tone: "warn", message: "Browser did not start audio. Press Play again." });
          }
        }, 1000);
      } else {
        await primeAudioElement(audio);
      }
      unlocked = true;
    } catch {
      unlocked = false;
    }

    setAudioUnlocked(unlocked);
    socket.emit("audio:ready", { participantToken, audioReady: unlocked });
    if (!unlocked) {
      setFlash({ tone: "warn", message: "Audio is still blocked. Click once in the room, then start playback again." });
    }
    return unlocked;
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
            audioUnlocked={audioUnlocked}
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
  audioUnlocked,
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
  audioUnlocked: boolean;
  onUnlockAudio: (trackToPrime?: Track | null) => Promise<boolean>;
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
      onStateChange={onStateChange}
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
      audioUnlocked={audioUnlocked}
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
    <section className="entry-experience entry-stitch z-10 flex flex-1 flex-col">
      <header className="entry-brand-bar">
        <span className="entry-wordmark">NERO PARTY</span>
        <button
          className="entry-about-button"
          type="button"
          onClick={() => setTab(tab === "create" ? "join" : "create")}
        >
          {tab === "create" ? "Join room" : "Create room"}
        </button>
      </header>

      <div className="setup-shell">
        <div className="setup-console">
          <div className="entry-copy-block">
            <p className="entry-kicker">{routeCode ? "Invite detected" : "Live listening room"}</p>
            <h1 className="entry-headline">Nero afterhours starts here.</h1>
            <p className="entry-subcopy">Add songs, rank your Top 3, reveal the track everyone remembers.</p>
          </div>

          <div className="entry-tab-switch" role="tablist" aria-label="Room action">
            <button
              className={tab === "create" ? "entry-tab-active" : ""}
              onClick={() => setTab("create")}
              type="button"
              role="tab"
              aria-selected={tab === "create"}
            >
              Create Room
            </button>
            <button
              className={tab === "join" ? "entry-tab-active" : ""}
              onClick={() => setTab("join")}
              type="button"
              role="tab"
              aria-selected={tab === "join"}
            >
              Join Room
            </button>
          </div>

          <div className="setup-form-shell">
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
                <div className="simple-room-controls">
                  <label className="setup-range-control">
                    <span>
                      <strong>Max submissions per user</strong>
                      <em>{maxSubmissionsPerParticipant}</em>
                    </span>
                    <input
                      className="setup-range"
                      type="range"
                      min={1}
                      max={10}
                      value={maxSubmissionsPerParticipant}
                      onChange={(event) => setMaxSubmissionsPerParticipant(Number(event.currentTarget.value))}
                    />
                  </label>
                  <div className="setup-source-block">
                    <p>Source options</p>
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
                        label="Upload"
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
                </div>
                <button className="hero-cta h-12 justify-center" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Launch room
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
                  Enter room
                </button>
              </form>
            )}
          </div>
        </div>

        <SetupPreview title={tab === "create" ? title : "Listening party"} mode={mode} tab={tab} settings={pendingSettings} />
      </div>
    </section>
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

function SetupPreview({ title, mode, tab, settings }: { title: string; mode: PartyMode; tab: string; settings: PartySettings }) {
  return (
    <aside className="setup-preview stitch-preview-stage">
      <div className="setup-preview-shade" aria-hidden />
      <div className="setup-preview-scanlines" aria-hidden />
      <div className="setup-gradient-boundary" aria-hidden />
      <div className="relative flex h-full min-h-[560px] items-center justify-center p-6 lg:justify-start lg:pl-12 xl:pl-20">
        <div className="preview-console-card stitch-live-preview" aria-label="Room preview">
          <div className="preview-console-top">
            <span className="preview-live-dot" />
            <strong>Live</strong>
            <em>{title || "Late night vibes"}</em>
          </div>

          <div className="preview-now-row">
            <div className="preview-album-tile" aria-hidden />
            <div className="min-w-0 flex-1">
              <p>Up next</p>
              <h3>{tab === "create" ? "Midnight City" : "Ready to join"}</h3>
              <small>{tab === "create" ? "M83" : formatEnabledSources(settings)}</small>
            </div>
            <div className="preview-eq-mini" aria-hidden>
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>

          <div className="preview-top-list">
            <div className="preview-top-heading">
              <span>Current Top 3</span>
              <span>Queue: {settings.maxQueueSize}</span>
            </div>
            <div className="preview-top-row preview-top-row-active">
              <span>1</span>
              <strong>Genesis</strong>
              <em>24 pts</em>
            </div>
            <div className="preview-top-row">
              <span>2</span>
              <strong>Nightcall</strong>
              <em>18 pts</em>
            </div>
            <div className="preview-top-row">
              <span>3</span>
              <strong>{mode === "focus" ? "Gosh" : "Overlay ready"}</strong>
              <em>{settings.maxSubmissionsPerParticipant} picks</em>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function FocusRoom({
  state,
  participant,
  participantToken,
  currentTrack,
  isHost,
  audioUnlocked,
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
  audioUnlocked: boolean;
  onUnlockAudio: (trackToPrime?: Track | null) => Promise<boolean>;
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
          audioUnlocked={audioUnlocked}
          onUnlockAudio={onUnlockAudio}
          onFlash={onFlash}
          onStateChange={onStateChange}
          onLeave={onLeave}
          onOpenSubmit={() => setLayer("submit")}
          onOpenRanking={() => setLayer("ranking")}
          onOpenQueue={() => setLayer("queue")}
          onOpenSaved={() => setLayer("saved")}
          onOpenOverlay={() => setLayer("overlay")}
        />
      </section>

      {layer === "submit" ? (
        <ModalLayer title="Add Song" eyebrow="Audius, Spotify, or upload" onClose={() => setLayer(null)}>
          <SubmissionPanel state={state} participant={participant} participantToken={participantToken} onFlash={onFlash} modal onTrackAdded={() => setLayer(null)} />
        </ModalLayer>
      ) : null}

      {layer === "ranking" ? (
        <DrawerLayer title="Modify Top 3" eyebrow="Private ranking" onClose={() => setLayer(null)}>
          <RankingBay state={state} participant={participant} participantToken={participantToken} tracks={listenedTracks} onFlash={onFlash} drawer />
        </DrawerLayer>
      ) : null}

      {layer === "queue" ? (
        <DrawerLayer title="Full Queue" eyebrow="Shared playback" onClose={() => setLayer(null)} side="left">
          <QueueRail state={state} drawer />
          <ParticipantRail state={state} drawer />
        </DrawerLayer>
      ) : null}

      {layer === "saved" ? (
        <DrawerLayer title="Saved Songs" eyebrow="Your exportable playlist" onClose={() => setLayer(null)}>
          <SavedSongsPanel state={state} participant={participant} onFlash={onFlash} />
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
              onStateChange={onStateChange}
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
  audioUnlocked,
  onUnlockAudio,
  onFlash,
  onStateChange,
  onLeave,
  onOpenSubmit,
  onOpenRanking,
  onOpenQueue,
  onOpenSaved,
  onOpenOverlay,
}: {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  currentTrack: Track | null;
  isHost: boolean;
  audioUnlocked: boolean;
  onUnlockAudio: (trackToPrime?: Track | null) => Promise<boolean>;
  onFlash: (flash: Flash) => void;
  onStateChange: (state: PartyState) => void;
  onLeave: () => void;
  onOpenSubmit: () => void;
  onOpenRanking: () => void;
  onOpenQueue: () => void;
  onOpenSaved: () => void;
  onOpenOverlay: () => void;
}) {
  const playbackSeconds = usePlaybackDisplaySeconds(state, currentTrack);
  const progress = currentTrack ? Math.min(100, Math.round((playbackSeconds / currentTrack.durationSeconds) * 100)) : 0;
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
        ? `${waitingCount} waiting. Host can press play when ready.`
        : "Add an Audius track, Spotify track, or approved upload to light up the room.";
  const participantRanking = getParticipantRanking(state, participant.id);
  const topTracks = participantRanking.map((trackId) => state.tracks.find((track) => track.id === trackId)).filter(Boolean) as Track[];
  const projectedWinners = getProjectedWinners(state);
  const stageTransitionKey = heroTrack?.id ?? stageLabel;
  return (
    <div className="stage-shell live-stage overflow-hidden">
      <div className="stage-orbit" aria-hidden />
      <div className="stage-light-beams" aria-hidden />
      <div className="relative grid min-h-[calc(100dvh-2rem)] gap-7">
        <header className="brand-appbar">
          <span className="brand-wordmark">NERO PARTY</span>
          <nav className="brand-nav" aria-label="Room actions">
            <button className="brand-nav-button" onClick={onOpenSubmit}>
              <Plus className="h-4 w-4" />
              Add Song
            </button>
            <button className="brand-nav-button" onClick={onOpenQueue}>
              <ListMusic className="h-4 w-4" />
              Queue
            </button>
            <button className="brand-nav-button" onClick={onOpenSaved}>
              <Heart className="h-4 w-4" />
              Saved {savedCount ? savedCount : ""}
            </button>
            <SpotifyHeaderAction state={state} participantToken={participantToken} />
            <button className="brand-nav-button brand-nav-danger" onClick={onLeave}>
              <DoorOpen className="h-4 w-4" />
              Leave
            </button>
          </nav>
        </header>

        <div className="stage-room-heading">
          <div className="live-context-pill">
            <span className="live-dot" />
            Live room
            <span>Web</span>
            <span>{state.party.code}</span>
          </div>
          <h2>{state.party.title}</h2>
          <p>{stageNote}</p>
        </div>

        {isFinalized ? (
          <div className="finale-room-wrap">
            <Winners state={state} />
          </div>
        ) : (
          <div className="live-room-main">
            <QueuePreviewCard state={state} onOpenQueue={onOpenQueue} />

            <div className="now-playing-core">
              <div key={stageTransitionKey} className="song-stage-transition">
                <TrackArtwork track={heroTrack} size="large" />
                <p className="mt-6 text-sm font-black uppercase tracking-[0.24em] text-nero-live/90">{stageLabel}</p>
                <h1 className="stage-title mt-3 max-w-5xl break-words text-center text-5xl font-light leading-none sm:text-6xl xl:text-7xl">
                  {heroTrack?.title ?? "Queue is open."}
                </h1>
                <p className="mt-4 max-w-2xl text-center text-lg text-white/60 sm:text-2xl">
                  {heroTrack?.artist ?? "Listen together, save what lands, and keep a private running ballot."}
                </p>

                <div className="mt-8 w-full max-w-3xl">
                  <div className="waveform-progress" aria-hidden>
                    {Array.from({ length: 72 }).map((_, index) => (
                      <span key={index} style={{ height: `${18 + ((index * 13) % 42)}%`, opacity: index / 72 <= progress / 100 ? 1 : 0.28 }} />
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-sm text-white/55">
                    <span>{currentTrack ? formatTime(playbackSeconds) : "0:00"}</span>
                    <span>{currentTrack ? formatTime(currentTrack.durationSeconds) : isPreview ? "Ready" : "Waiting"}</span>
                  </div>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                {currentTrack ? (
                  <QuickActions state={state} participant={participant} participantToken={participantToken} track={currentTrack} onFlash={onFlash} onStateChange={onStateChange} />
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
                  <HostControls
                    state={state}
                    participantToken={participantToken}
                    currentTrack={currentTrack}
                    audioUnlocked={audioUnlocked}
                    onFlash={onFlash}
                    onStateChange={onStateChange}
                    onPrimeAudio={onUnlockAudio}
                  />
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
        )}
      </div>
    </div>
  );
}

function usePlaybackDisplaySeconds(state: PartyState, currentTrack: Track | null) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { playback } = state;

  useEffect(() => {
    setNowMs(Date.now());
    if (!playback.isPlaying || !currentTrack) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [currentTrack?.id, currentTrack?.durationSeconds, playback.currentTrackId, playback.isPlaying, playback.positionSeconds, playback.serverNow]);

  if (!currentTrack) return 0;
  const basePosition = getPlayableAudioPosition(playback.positionSeconds, currentTrack.durationSeconds);
  const snapshotTime = Date.parse(playback.serverNow);
  const elapsed = playback.isPlaying && Number.isFinite(snapshotTime) ? Math.max(0, (nowMs - snapshotTime) / 1000) : 0;
  return Math.min(currentTrack.durationSeconds, basePosition + elapsed);
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

function TrackThumb({ track, live = false }: { track: Pick<Track, "title" | "artworkUrl"> | null; live?: boolean }) {
  return (
    <span className={`track-thumb ${live ? "track-thumb-live" : ""}`}>
      {track?.artworkUrl ? <img src={track.artworkUrl} alt="" /> : <Music2 className="h-5 w-5" />}
      {live ? (
        <span className="track-thumb-eq" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </span>
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
  onStateChange,
}: {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  track: Track;
  onFlash: (flash: Flash) => void;
  onStateChange: (state: PartyState) => void;
}) {
  const participantRanking = getParticipantRanking(state, participant.id);
  const saved = state.savedTracks.some((savedTrack) => savedTrack.participantId === participant.id && savedTrack.trackId === track.id);
  const isTopPick = participantRanking[0] === track.id;

  return (
    <>
      <button
        className={`secondary-button ${saved ? "action-confirmed" : ""}`}
        onClick={() =>
          saveTrack(participant.id, participantToken, track.id)
            .then((result) => {
              onStateChange(result.state);
              onFlash({ tone: "good", message: "Saved to your party playlist." });
            })
            .catch((error) => onFlash({ tone: "bad", message: getErrorMessage(error) }))
        }
      >
        <Heart className={`h-4 w-4 ${saved ? "fill-nero-live text-nero-live" : ""}`} />
        Save
      </button>
      <button
        className={`primary-button ${isTopPick ? "action-confirmed" : ""}`}
        onClick={() =>
          updateRanking(participant.id, participantToken, putTrackInTopThree(participantRanking, track.id))
            .then((result) => {
              onStateChange(result.state);
              onFlash({ tone: "good", message: "Moved into your Top 3." });
            })
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
  const [webPlaybackState, setWebPlaybackState] = useState<SpotifyWebPlaybackState>("idle");
  const hasStreamingScope = hasSpotifyScope(status?.scope ?? null, "streaming");

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

  useEffect(() => {
    if (!status?.configured || !status.connected || status.playbackReady || !hasStreamingScope) return;
    let cancelled = false;
    let player: SpotifyWebPlayer | null = null;

    async function startBrowserPlaybackDevice() {
      setWebPlaybackState("starting");
      const { accessToken } = await getSpotifyWebToken(state.party.id, participantToken);
      await loadSpotifyWebPlaybackSdk();
      if (cancelled || !window.Spotify?.Player) return;

      player = new window.Spotify.Player({
        name: "Nero Party Web",
        getOAuthToken: (callback) => callback(accessToken),
        volume: 0.8,
      });

      player.addListener("ready", ({ device_id: deviceId }) => {
        void setSpotifyDevice(state.party.id, participantToken, deviceId)
          .then(() => {
            if (cancelled) return;
            setStatus((current) =>
              current
                ? {
                    ...current,
                    playbackReady: true,
                    deviceName: "Nero Party Web",
                    deviceCount: Math.max(current.deviceCount ?? 0, 1),
                    deviceError: null,
                  }
                : current,
            );
            setWebPlaybackState("ready");
          })
          .catch(() => {
            if (!cancelled) setWebPlaybackState("unavailable");
          });
      });
      player.addListener("not_ready", () => {
        if (!cancelled) setWebPlaybackState("unavailable");
      });
      const onPlayerError = ({ message }: { message: string }) => {
        if (cancelled) return;
        setStatus((current) => (current ? { ...current, playbackReady: false, deviceError: message } : current));
        setWebPlaybackState("unavailable");
      };
      player.addListener("initialization_error", onPlayerError);
      player.addListener("authentication_error", onPlayerError);
      player.addListener("account_error", onPlayerError);
      player.addListener("playback_error", onPlayerError);

      const connected = await player.connect();
      if (!connected && !cancelled) setWebPlaybackState("unavailable");
    }

    void startBrowserPlaybackDevice().catch((error) => {
      if (cancelled) return;
      setStatus((current) => (current ? { ...current, playbackReady: false, deviceError: getErrorMessage(error) } : current));
      setWebPlaybackState("unavailable");
    });

    return () => {
      cancelled = true;
      player?.disconnect();
    };
  }, [hasStreamingScope, participantToken, state.party.id, status?.configured, status?.connected, status?.playbackReady]);

  if (!status?.configured) return null;

  const connectedReady = Boolean(status.connected && status.playbackReady);
  const connectedNotReady = Boolean(status.connected && !status.playbackReady);
  const label = !status.connected
    ? "Connect Spotify"
    : connectedReady
      ? "Spotify ready"
      : !hasStreamingScope
        ? "Reconnect Spotify"
      : webPlaybackState === "starting"
        ? "Starting Spotify"
        : "Open Spotify";
  const title = !status.connected
    ? "Connect Spotify"
    : connectedReady
      ? `Spotify ready${status.deviceName ? ` on ${status.deviceName}` : ""}`
      : !hasStreamingScope
        ? "Reconnect Spotify once so Nero can request browser playback permission."
      : status.deviceError ?? "Keep this tab open, or open Spotify desktop/mobile so Nero can target a playback device.";

  return (
    <a
      className={`spotify-header-button ${connectedReady ? "spotify-header-button-connected" : ""} ${connectedNotReady ? "spotify-header-button-warning" : ""}`}
      href={spotifyLoginUrl(state.party.id, participantToken)}
      title={title}
    >
      {webPlaybackState === "starting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Disc3 className="h-4 w-4" />}
      <span>{label}</span>
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

function SavedSongsPanel({ state, participant, onFlash }: { state: PartyState; participant: Participant; onFlash: (flash: Flash) => void }) {
  const savedTracks = getSavedTracks(state, participant.id);
  const exportText = formatSavedSongsExport(savedTracks, state.party.title);
  const csvText = formatSavedSongsCsv(savedTracks);

  async function copySavedSongs() {
    if (!savedTracks.length) {
      onFlash({ tone: "warn", message: "Save a song first, then export your list." });
      return;
    }
    try {
      await navigator.clipboard.writeText(exportText);
      onFlash({ tone: "good", message: "Saved songs copied." });
    } catch {
      downloadTextFile(`nero-${state.party.code}-saved-songs.txt`, exportText, "text/plain;charset=utf-8");
      onFlash({ tone: "good", message: "Clipboard was unavailable, so Nero downloaded your saved list." });
    }
  }

  function downloadSavedSongs() {
    if (!savedTracks.length) {
      onFlash({ tone: "warn", message: "Save a song first, then export your list." });
      return;
    }
    downloadTextFile(`nero-${state.party.code}-saved-songs.csv`, csvText, "text/csv;charset=utf-8");
    onFlash({ tone: "good", message: "Saved songs exported." });
  }

  return (
    <section className="drawer-section saved-songs-surface">
      <div className="side-card-header">
        <div className="min-w-0">
          <p className="side-card-kicker">Saved songs</p>
          <h3>{savedTracks.length} saved</h3>
          <p className="side-card-copy">Export your party playlist any time, even after End Game.</p>
        </div>
        <Heart className="h-5 w-5 text-nero-live" />
      </div>

      <div className="saved-export-actions">
        <button className="secondary-button" onClick={copySavedSongs}>
          <Copy className="h-4 w-4" />
          Copy list
        </button>
        <button className="primary-button" onClick={downloadSavedSongs}>
          <Download className="h-4 w-4" />
          Download CSV
        </button>
      </div>

      <div className="saved-song-list">
        {savedTracks.map((track, index) => (
          <div key={track.id} className="saved-song-row">
            <span className="queue-row-index">{index + 1}</span>
            <TrackThumb track={track} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{track.title}</p>
              <p className="truncate text-xs text-nero-mist">{track.artist}</p>
            </div>
            <span className="queue-row-duration">{formatDurationCompact(track.durationSeconds)}</span>
          </div>
        ))}
        {!savedTracks.length ? <div className="source-empty-state">Saved songs land here when you tap Save during playback.</div> : null}
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
  currentTrack,
  audioUnlocked,
  onFlash,
  onStateChange,
  onPrimeAudio,
}: {
  state: PartyState;
  participantToken: string;
  currentTrack: Track | null;
  audioUnlocked: boolean;
  onFlash: (flash: Flash) => void;
  onStateChange: (state: PartyState) => void;
  onPrimeAudio: (trackToPrime?: Track | null) => Promise<boolean>;
}) {
  const [busyAction, setBusyAction] = useState<"play" | "skip" | "end" | null>(null);
  const queuedTracks = state.tracks.filter((track) => track.status === "queued");
  const queuedCount = queuedTracks.length;
  const nextQueuedTrack = queuedTracks[0] ?? null;
  const hasCurrentTrack = Boolean(state.playback.currentTrackId);
  const isPlaying = state.playback.isPlaying;
  const isFinalized = state.party.status === "finalized";
  const trackToPrime = currentTrack ?? nextQueuedTrack;
  const needsLocalAudioResume = isPlaying && currentTrack?.sourceType !== "spotify" && !audioUnlocked;
  const playButtonIsPause = isPlaying && !needsLocalAudioResume;
  const canPlayPause = !isFinalized && (hasCurrentTrack || queuedCount > 0);
  const canSkip = !isFinalized && (hasCurrentTrack || queuedCount > 0);
  const canEnd = !isFinalized;

  const common = async (action: "play" | "skip" | "end", run: () => Promise<{ state: PartyState }>, message: string) => {
    if (busyAction) return;
    setBusyAction(action);
    try {
      if ((action === "play" || action === "skip") && !isPlaying && trackToPrime?.sourceType !== "spotify") {
        if (!trackToPrime?.streamUrl) {
          onFlash({ tone: "bad", message: "This track does not have a playable browser audio URL. Add another source." });
          return;
        }
        const audioReady = await onPrimeAudio(trackToPrime);
        if (!audioReady) return;
      }
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
    <div className="host-strip" data-host-controls>
      <span className="host-strip-label">Host controls</span>
      <div className="host-strip-actions">
        <button
          className="primary-button playback-round-button"
          disabled={!canPlayPause || Boolean(busyAction)}
          onClick={() =>
            void common(
              "play",
              async () => {
                if (needsLocalAudioResume) {
                  const audioReady = await onPrimeAudio(currentTrack);
                  if (!audioReady) throw new Error("Browser blocked audio. Press Play again.");
                  return { state };
                }
                return playButtonIsPause ? pausePlayback(state.party.id, participantToken) : startPlayback(state.party.id, participantToken);
              },
              needsLocalAudioResume ? "Audio resumed." : playButtonIsPause ? "Playback paused." : "Playback started.",
            )
          }
          title={playButtonIsPause ? "Pause" : "Play"}
          aria-label={playButtonIsPause ? "Pause" : "Play"}
        >
          {busyAction === "play" ? <Loader2 className="h-4 w-4 animate-spin" /> : playButtonIsPause ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        <button
          className="secondary-button playback-icon-button"
          disabled={!canSkip || Boolean(busyAction)}
          onClick={() => void common("skip", () => advancePlayback(state.party.id, participantToken), "Skipped to next track.")}
          title="Skip to next track"
          aria-label="Skip to next track"
        >
          {busyAction === "skip" ? <Loader2 className="h-4 w-4 animate-spin" /> : <SkipForward className="h-4 w-4 fill-current" />}
        </button>
        <button className="secondary-button" disabled={!canEnd || Boolean(busyAction)} onClick={() => void common("end", () => finalizeParty(state.party.id, participantToken), "Game ended. Final ballot locked.")}>
          {busyAction === "end" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
          {busyAction === "end" ? "Ending" : "End Game"}
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

function DrawerLayer({
  title,
  eyebrow,
  children,
  onClose,
  side = "right",
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  onClose: () => void;
  side?: "left" | "right";
}) {
  return (
    <div className={`app-layer-backdrop app-layer-drawer-backdrop ${side === "left" ? "app-layer-drawer-left" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <aside className={`app-drawer ${side === "left" ? "app-drawer-left" : ""}`}>
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
  onStateChange,
  onExpand,
  surface = "web",
}: {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  currentTrack: Track | null;
  onFlash: (flash: Flash) => void;
  onStateChange: (state: PartyState) => void;
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
              <QuickActions state={state} participant={participant} participantToken={participantToken} track={currentTrack} onFlash={onFlash} onStateChange={onStateChange} />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.035] px-4 py-5 text-sm text-white/55">
              Press play in Focus Mode or wait for the host.
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
    <section className={`${drawer ? "drawer-section top3-drawer-surface" : "room-panel"} ${compact ? "p-3" : "ballot-dock p-4"}`}>
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
              className={`ranking-row ${compact ? "" : "ranking-row-dock"} ${track ? "ranking-row-filled" : "ranking-row-empty"}`}
            >
              <div className="ranking-rank-mark">#{index + 1}</div>
              {track ? <TrackThumb track={track} /> : <div className="ranking-empty-art"><Plus className="h-4 w-4" /></div>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{track?.title ?? "Open slot"}</p>
                <p className="truncate text-xs text-nero-mist">{track?.artist ?? "Select from listened history"}</p>
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
                className="history-row history-track-row"
                onClick={() => commit(putTrackInTopThree(rankingIds, track.id), "Moved into your Top 3.")}
              >
                <TrackThumb track={track} />
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
  const playing = state.tracks.find((track) => track.status === "playing") ?? null;
  const played = state.tracks.filter((track) => track.status === "played").slice(-8).reverse();
  return (
    <section className={`${drawer ? "drawer-section queue-drawer-surface" : "room-panel"} flex min-h-0 flex-col p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-nero-live">Room queue</p>
          <h3 className="text-xl font-semibold">{state.tracks.length} track{state.tracks.length === 1 ? "" : "s"} total</h3>
        </div>
        <ListMusic className="h-5 w-5 text-nero-live" aria-hidden />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <StatPuck value={upcoming.length} label="Queue" />
        <StatPuck value={playedCount} label="Played" />
        <StatPuck value={state.participants.length} label="People" />
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-6">
          {playing ? (
            <section className="queue-drawer-section">
              <p className="queue-drawer-heading"><span className="live-dot" />Now Playing</p>
              <QueueDrawerRow track={playing} index="Live" live />
            </section>
          ) : null}

          <section className="queue-drawer-section">
            <p className="queue-drawer-heading">Up Next</p>
            <div className="grid gap-2">
              {upcoming.map((track, index) => (
                <QueueDrawerRow key={track.id} track={track} index={String(index + 1)} />
              ))}
              {!upcoming.length ? <div className="rail-empty">No tracks queued yet.</div> : null}
            </div>
          </section>

          <section className="queue-drawer-section">
            <p className="queue-drawer-heading">Listened History</p>
            <div className="grid gap-2">
              {played.map((track) => (
                <QueueDrawerRow key={track.id} track={track} index="Played" played />
              ))}
              {!played.length ? <div className="rail-empty">Played songs land here.</div> : null}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function QueueDrawerRow({ track, index, live = false, played = false }: { track: Track; index: string; live?: boolean; played?: boolean }) {
  return (
    <div className={`queue-row queue-drawer-row ${live ? "queue-row-live" : ""} ${played ? "queue-row-played" : ""}`}>
      <span className="queue-row-index">{index}</span>
      <TrackThumb track={track} live={live} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{track.title}</p>
        <p className="truncate text-xs text-nero-mist">{track.artist} · submitted by {track.submittedByName}</p>
      </div>
      <span className="queue-row-duration">{formatDurationCompact(track.durationSeconds)}</span>
    </div>
  );
}

function ParticipantRail({ state, drawer = false }: { state: PartyState; drawer?: boolean }) {
  return (
    <section className={`${drawer ? "drawer-section participant-drawer-section" : "room-panel"} p-4`}>
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
    <section className={`${modal ? "submit-modal-surface submit-panel-stitch" : "room-panel"} flex min-h-0 flex-col p-4`}>
      {!modal ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-nero-live">Submit</p>
            <h3 className="text-xl font-semibold">Add a song</h3>
          </div>
          <Music2 className="h-5 w-5 text-nero-live" aria-hidden />
        </div>
      ) : (
        <div className="submit-modal-summary">
          <Music2 className="h-5 w-5 text-nero-live" />
          <span>{remainingSubmissions} submission{remainingSubmissions === 1 ? "" : "s"} left</span>
          <span>{remainingTracks} room slot{remainingTracks === 1 ? "" : "s"}</span>
          <span>{formatDurationCompact(remainingSeconds)} left</span>
        </div>
      )}

      <div className="source-switch mt-4">
        <button
          className={sourceTab === "audius" ? "source-switch-active" : ""}
          onClick={() => setSourceTab("audius")}
          type="button"
          disabled={!sourceAllowed.audius}
        >
          <Search className="h-4 w-4" />
          Audius Search
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

      {sourceTab === "spotify" || sourceTab === "audius" ? (
        <div className="mt-4 grid gap-3">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <input
              className="field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={sourceTab === "spotify" ? "Search Spotify" : "Search Audius"}
            />
            <button
              type="submit"
              className="icon-button h-11 w-11"
              disabled={loading}
              title={sourceTab === "spotify" ? "Search Spotify" : "Search Audius"}
              aria-label={sourceTab === "spotify" ? "Search Spotify" : "Search Audius"}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </button>
          </form>
          <div className="max-h-64 overflow-y-auto pr-1">
            <div className="grid gap-2">
              {results.map((track) => {
                const blocker = submissionBlocker(track.durationSeconds);
                return (
                  <button
                    key={track.sourceId}
                    className="history-row search-result-row"
                    onClick={() => addSearchTrack(track)}
                    disabled={Boolean(blocker)}
                    title={blocker ?? `Add ${track.title}`}
                  >
                    <TrackThumb track={track} />
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-sm font-semibold">{track.title}</span>
                      <span className="block truncate text-xs text-nero-mist">{track.artist}</span>
                    </span>
                    <span className="search-result-side">
                      <small>{formatDurationCompact(track.durationSeconds)}</small>
                      <em>{track.sourceType}</em>
                      {track.sourceType === "spotify" ? <Disc3 className="h-4 w-4 text-nero-live" /> : <Plus className="h-4 w-4 text-nero-live" />}
                    </span>
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
    <div className="finale-stage finale-theater">
      <div className="finale-rays" aria-hidden />
      <div className="finale-spotlight finale-spotlight-one" aria-hidden />
      <div className="finale-spotlight finale-spotlight-two" aria-hidden />

      <div className="finale-title-block">
        <p>Final Results</p>
        <h2>{winner ? "Room Winner" : "Ballots Locked"}</h2>
        <div className="finale-score-note">
          <span>{totalBallots} ballot{totalBallots === 1 ? "" : "s"} counted</span>
          <span>{state.tracks.length} tracks heard</span>
          <span>5 / 3 / 1 scoring</span>
        </div>
      </div>

      {winner ? (
        <div className="finale-winner-hero">
          <span className="finale-rank finale-rank-xl">1</span>
          <TrackArtwork track={winnerTrack} size="small" />
          <div className="min-w-0">
            <p className="finale-winner-label"><Trophy className="h-4 w-4" /> Winner</p>
            <h3>{winner.title}</h3>
            <p>{winner.artist} · submitted by {winner.submittedByName}</p>
          </div>
          <div className="finale-winner-score">
            <strong>{winner.score}</strong>
            <span>pts</span>
            <small>{winner.firstPlaceVotes} first-place</small>
          </div>
        </div>
      ) : (
        <div className="source-empty-state mt-6">No Top 3 ballots were submitted before finale.</div>
      )}

      {state.winners.length ? (
        <div className="finale-podium finale-podium-theater">
          {state.winners.slice(0, 3).map((nextWinner, index) => {
            const rankClass = index === 0 ? "finale-card-1" : index === 1 ? "finale-card-2" : "finale-card-3";
            return (
              <div key={nextWinner.trackId} className={`finale-card ${rankClass}`}>
                <span className="finale-rank">{index + 1}</span>
                <TrackArtwork track={state.tracks.find((track) => track.id === nextWinner.trackId) ?? null} size="small" />
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{nextWinner.title}</p>
                  <p className="truncate text-sm text-white/55">{nextWinner.artist}</p>
                  <small>submitted by {nextWinner.submittedByName}</small>
                </div>
                <div className="finale-card-score">
                  <strong>{nextWinner.score}</strong>
                  <span>{nextWinner.appearances} vote{nextWinner.appearances === 1 ? "" : "s"}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <p className="finale-rules-copy">
        Final ballots use each listener's current Top 3. Tie-breaks go by first-place votes, appearances, then earlier queue position.
      </p>
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

function getSavedTracks(state: PartyState, participantId: string) {
  const trackById = new Map(state.tracks.map((track) => [track.id, track]));
  return state.savedTracks
    .filter((savedTrack) => savedTrack.participantId === participantId)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .map((savedTrack) => trackById.get(savedTrack.trackId))
    .filter(Boolean) as Track[];
}

function formatSavedSongsExport(tracks: Track[], partyTitle: string) {
  const lines = [`Nero Party saved songs - ${partyTitle}`, ""];
  tracks.forEach((track, index) => {
    lines.push(`${index + 1}. ${track.title} - ${track.artist}`);
  });
  return lines.join("\n");
}

function formatSavedSongsCsv(tracks: Track[]) {
  const rows = [["Rank", "Title", "Artist", "Source", "Duration Seconds"]];
  tracks.forEach((track, index) => {
    rows.push([String(index + 1), track.title, track.artist, track.sourceType, String(track.durationSeconds)]);
  });
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadTextFile(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
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

function clampPlaybackPosition(positionSeconds: number, durationSeconds: number) {
  const maxPosition = Math.max(0, durationSeconds - 0.25);
  return Math.max(0, Math.min(positionSeconds, maxPosition));
}

function getPlayableAudioPosition(positionSeconds: number, durationSeconds: number) {
  if (positionSeconds >= durationSeconds - 0.5) return 0;
  return clampPlaybackPosition(positionSeconds, durationSeconds);
}

function setAudioPosition(audio: HTMLAudioElement, positionSeconds: number, durationSeconds: number) {
  try {
    audio.currentTime = getPlayableAudioPosition(positionSeconds, durationSeconds);
  } catch {
    // Some streamed sources reject seeking before metadata is available. Playback can still start at 0.
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function hasSpotifyScope(scope: string | null, requiredScope: string) {
  return new Set((scope ?? "").split(/\s+/).filter(Boolean)).has(requiredScope);
}

async function primeAudioElement(audio: HTMLAudioElement) {
  const previousSrc = audio.getAttribute("src");
  const previousVolume = audio.volume;
  const previousMuted = audio.muted;

  audio.pause();
  audio.src = SILENT_AUDIO_DATA_URL;
  audio.volume = 0;
  audio.muted = false;

  try {
    const played = await Promise.race([
      audio.play().then(
        () => true,
        () => false,
      ),
      wait(500).then(() => true),
    ]);
    if (!played) throw new Error("Audio prime failed.");
    audio.pause();
    audio.currentTime = 0;
  } finally {
    audio.volume = previousVolume;
    audio.muted = previousMuted;
    if (previousSrc) {
      audio.src = previousSrc;
    } else {
      audio.removeAttribute("src");
      audio.load();
    }
  }
}

function loadSpotifyWebPlaybackSdk() {
  if (window.Spotify?.Player) return Promise.resolve();
  if (spotifySdkPromise) return spotifySdkPromise;

  spotifySdkPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://sdk.scdn.co/spotify-player.js"]');
    const previousReady = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      previousReady?.();
      resolve();
    };
    if (existingScript) {
      existingScript.addEventListener("error", () => reject(new Error("Spotify browser player failed to load.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onerror = () => reject(new Error("Spotify browser player failed to load."));
    document.body.appendChild(script);
  });
  spotifySdkPromise.catch(() => {
    spotifySdkPromise = null;
  });

  return spotifySdkPromise;
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
