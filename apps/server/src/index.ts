import cors, { type CorsOptions } from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import pino from "pino";
import { PrismaClient } from "@prisma/client";
import { Server } from "socket.io";
import { AudiusClient, SpotifyClient, isSupportedUploadMimeType, sanitizeUploadFileName } from "@nero/player";
import {
  addTrackSchema,
  audiusSearchSchema,
  createPartySchema,
  defaultPartySettings,
  joinPartySchema,
  normalizeRanking,
  playbackCommandSchema,
  putTrackInTopThree,
  reactionSchema,
  saveTrackSchema,
  scoreBallots,
  updateRankingSchema,
  type Ballot,
  type Participant,
  type PartySettings,
  type PartyState,
  type Reaction,
  type Track,
} from "@nero/shared";
import { env } from "./env.js";

const log = pino({ name: "nero-server" });
const prisma = new PrismaClient();
const audius = new AudiusClient({ apiBase: env.AUDIUS_API_BASE });
const spotify = new SpotifyClient({
  clientId: env.SPOTIFY_CLIENT_ID,
  clientSecret: env.SPOTIFY_CLIENT_SECRET,
  redirectUri: env.SPOTIFY_REDIRECT_URI,
});
const spotifyAuthStates = new Map<string, { partyId: string; participantToken: string; expiresAt: number }>();
const app = express();
const server = createServer(app);
const corsOptions: CorsOptions = {
  origin: allowCorsOrigin,
};
const io = new Server(server, {
  cors: {
    origin: allowCorsOrigin,
    methods: ["GET", "POST", "PUT"],
  },
});

const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, callback) => {
      const ext = path.extname(file.originalname) || ".mp3";
      const baseName = sanitizeUploadFileName(path.basename(file.originalname, ext)) || "nero-upload";
      callback(null, `${Date.now()}-${nanoid(8)}-${baseName}${ext}`);
    },
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!isSupportedUploadMimeType(file.mimetype)) {
      callback(new Error("Upload must be an MP3, WAV, FLAC, AAC, or MP4 audio file."));
      return;
    }
    callback(null, true);
  },
});

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadDir));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "nero-party", time: new Date().toISOString() });
});

app.post(
  "/api/parties",
  asyncHandler(async (req, res) => {
    const body = createPartySchema.parse(req.body);
    const settings: PartySettings = { ...defaultPartySettings(), ...body.settings };
    const code = await makeUniquePartyCode();
    const hostToken = nanoid(32);
    const party = await prisma.party.create({
      data: {
        code,
        title: body.title,
        mode: body.mode,
        settings: JSON.stringify(settings),
        participants: {
          create: {
            displayName: body.hostName,
            role: "host",
            source: "web",
            token: hostToken,
          },
        },
        playback: {
          create: {},
        },
        eventLogs: {
          create: {
            type: "party.created",
            payload: JSON.stringify({ hostName: body.hostName }),
          },
        },
      },
      include: { participants: true },
    });

    const state = await getPartyState(party.id);
    res.status(201).json({ partyCode: party.code, participantToken: hostToken, state });
  }),
);

app.get(
  "/api/parties/:code",
  asyncHandler(async (req, res) => {
    const state = await getPartyState(req.params.code);
    res.json(state);
  }),
);

app.post(
  "/api/parties/:code/join",
  asyncHandler(async (req, res) => {
    const body = joinPartySchema.parse(req.body);
    const party = await findParty(req.params.code);
    let participant = body.participantToken
      ? await prisma.participant.findFirst({ where: { partyId: party.id, token: body.participantToken } })
      : null;

    if (!participant) {
      participant = await prisma.participant.create({
        data: {
          partyId: party.id,
          displayName: body.displayName,
          role: "guest",
          source: body.source,
          token: nanoid(32),
        },
      });
      await logEvent(party.id, "participant.joined", { participantId: participant.id, displayName: participant.displayName });
    } else {
      participant = await prisma.participant.update({
        where: { id: participant.id },
        data: { displayName: body.displayName, isPresent: true, source: body.source },
      });
    }

    await emitPartyState(party.id);
    res.json({ participantToken: participant.token, state: await getPartyState(party.id) });
  }),
);

app.get(
  "/api/search/audius",
  asyncHandler(async (req, res) => {
    const { q } = audiusSearchSchema.parse(req.query);
    const results = await audius.searchTracks(q);
    res.json({ results });
  }),
);

app.get(
  "/api/search/spotify",
  asyncHandler(async (req, res) => {
    const { q } = audiusSearchSchema.parse(req.query);
    const results = await spotify.searchTracks(q);
    res.json({ results });
  }),
);

app.get(
  "/api/parties/:partyId/spotify/status",
  asyncHandler(async (req, res) => {
    const party = await findParty(req.params.partyId);
    const participantToken = typeof req.query.participantToken === "string" ? req.query.participantToken : "";
    const participant = participantToken ? await prisma.participant.findFirst({ where: { partyId: party.id, token: participantToken } }) : null;
    const [hostConnection, listenerConnection, roomConnectionCount] = await Promise.all([
      prisma.spotifyConnection.findUnique({ where: { partyId: party.id } }),
      participant ? prisma.listenerSpotifyConnection.findUnique({ where: { participantId: participant.id } }) : null,
      prisma.listenerSpotifyConnection.count({ where: { partyId: party.id } }),
    ]);
    const connection = listenerConnection ?? (participant?.role === "host" ? hostConnection : null);
    res.json({
      configured: spotify.isConfigured(),
      connected: Boolean(connection),
      displayName: connection?.displayName ?? null,
      spotifyUserId: connection?.spotifyUserId ?? null,
      expiresAt: connection?.expiresAt.toISOString() ?? null,
      scope: connection?.scope ?? null,
      roomConnectionCount,
      hostConnected: Boolean(hostConnection),
    });
  }),
);

app.get(
  "/api/parties/:partyId/spotify/login",
  asyncHandler(async (req, res) => {
    if (!spotify.isConfigured()) {
      res.status(501).json({ message: "Spotify is not configured for this Nero server." });
      return;
    }
    const party = await findParty(req.params.partyId);
    const participantToken = String(req.query.participantToken ?? "");
    await requireParticipant(party.id, participantToken);
    const state = nanoid(32);
    spotifyAuthStates.set(state, {
      partyId: party.id,
      participantToken,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    res.redirect(spotify.buildAuthorizationUrl(state, env.SPOTIFY_SCOPES));
  }),
);

app.get(
  "/api/spotify/callback",
  asyncHandler(async (req, res) => {
    const stateId = typeof req.query.state === "string" ? req.query.state : "";
    const authState = spotifyAuthStates.get(stateId);
    spotifyAuthStates.delete(stateId);

    if (!authState || authState.expiresAt < Date.now()) {
      res.redirect(withSpotifyResult(env.PUBLIC_WEB_URL, "error"));
      return;
    }

    const party = await findParty(authState.partyId);
    const error = typeof req.query.error === "string" ? req.query.error : "";
    if (error) {
      await logEvent(party.id, "spotify.oauth_failed", { error });
      res.redirect(withSpotifyResult(`${env.PUBLIC_WEB_URL}/party/${party.code}`, "error"));
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      res.redirect(withSpotifyResult(`${env.PUBLIC_WEB_URL}/party/${party.code}`, "error"));
      return;
    }

    const tokens = await spotify.exchangeCode(code);
    if (!tokens.refreshToken) {
      throw new Error("Spotify did not return a refresh token. Reconnect with Spotify consent enabled.");
    }
    const profile = await spotify.getProfile(tokens.accessToken);
    const participant = await requireParticipant(party.id, authState.participantToken);
    const connectionData = {
      spotifyUserId: profile.id,
      displayName: profile.displayName,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
      expiresAt: new Date(tokens.expiresAt),
    };
    await prisma.listenerSpotifyConnection.upsert({
      where: { participantId: participant.id },
      create: {
        partyId: party.id,
        participantId: participant.id,
        ...connectionData,
      },
      update: connectionData,
    });
    if (participant.role === "host") {
      await prisma.spotifyConnection.upsert({
        where: { partyId: party.id },
        create: {
          partyId: party.id,
          ...connectionData,
        },
        update: connectionData,
      });
    }
    await logEvent(party.id, "spotify.connected", { participantId: participant.id, spotifyUserId: profile.id, displayName: profile.displayName });
    await emitPartyEvent(party.id, "spotify:connected", { participantId: participant.id, displayName: profile.displayName });
    await emitPartyState(party.id);
    res.redirect(withSpotifyResult(`${env.PUBLIC_WEB_URL}/party/${party.code}`, "connected"));
  }),
);

app.post(
  "/api/uploads/audio",
  upload.single("audio"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ message: "Attach an audio file in the 'audio' field." });
      return;
    }
    const title = String(req.body.title ?? path.basename(req.file.originalname, path.extname(req.file.originalname))).slice(0, 160);
    const artist = String(req.body.artist ?? "Uploaded artist").slice(0, 160);
    const durationSeconds = Number(req.body.durationSeconds ?? 180);
    const streamUrl = `${env.PUBLIC_API_URL}/uploads/${encodeURIComponent(req.file.filename)}`;
    res.status(201).json({
      sourceType: "upload",
      sourceId: req.file.filename,
      title,
      artist,
      artworkUrl: null,
      streamUrl,
      durationSeconds,
    });
  }),
);

app.post(
  "/api/parties/:partyId/tracks",
  asyncHandler(async (req, res) => {
    const body = addTrackSchema.parse(req.body);
    const participant = await requireParticipant(req.params.partyId, body.participantToken);
    const party = await prisma.party.findUniqueOrThrow({ where: { id: req.params.partyId } });
    const settings = parseSettings(party.settings);
    const sourceAllowed = {
      audius: settings.allowAudius,
      spotify: settings.allowSpotify,
      upload: settings.allowUploads,
    }[body.sourceType];

    if (!sourceAllowed) {
      res.status(409).json({ message: `${body.sourceType} submissions are disabled for this room.` });
      return;
    }

    const [submittedCount, queueCount, durationTotal] = await Promise.all([
      prisma.track.count({ where: { partyId: party.id, submittedByParticipantId: participant.id } }),
      prisma.track.count({ where: { partyId: party.id } }),
      prisma.track.aggregate({ where: { partyId: party.id }, _sum: { durationSeconds: true } }),
    ]);
    const scheduledSeconds = durationTotal._sum.durationSeconds ?? 0;
    const maxDurationSeconds = settings.maxDurationMinutes * 60;

    if (submittedCount >= settings.maxSubmissionsPerParticipant) {
      res.status(409).json({ message: "You have used all submissions for this room." });
      return;
    }
    if (queueCount >= settings.maxQueueSize) {
      res.status(409).json({ message: "The room queue is full." });
      return;
    }
    if (scheduledSeconds + body.durationSeconds > maxDurationSeconds) {
      res.status(409).json({
        message: `This room is capped at ${settings.maxDurationMinutes} minutes. Choose a shorter track or start a new room.`,
      });
      return;
    }

    const track = await prisma.track.create({
      data: {
        partyId: party.id,
        sourceType: body.sourceType,
        sourceId: body.sourceId,
        title: body.title,
        artist: body.artist,
        artworkUrl: body.artworkUrl,
        streamUrl: body.streamUrl,
        durationSeconds: body.durationSeconds,
        queuePosition: queueCount + 1,
        submittedByParticipantId: participant.id,
      },
    });
    await logEvent(party.id, "track.added", { trackId: track.id, participantId: participant.id });
    io.to(roomName(party.code)).emit("track:added", { trackId: track.id });
    await emitPartyState(party.id);
    res.status(201).json({ track, state: await getPartyState(party.id) });
  }),
);

app.post(
  "/api/participants/:participantId/saved-tracks",
  asyncHandler(async (req, res) => {
    const body = saveTrackSchema.parse(req.body);
    const participant = await prisma.participant.findUniqueOrThrow({ where: { id: req.params.participantId } });
    if (participant.token !== body.participantToken) {
      res.status(403).json({ message: "Participant token does not match." });
      return;
    }
    await prisma.savedTrack.upsert({
      where: { participantId_trackId: { participantId: participant.id, trackId: body.trackId } },
      create: { participantId: participant.id, trackId: body.trackId },
      update: {},
    });
    await emitPartyEvent(participant.partyId, "saved:updated", { participantId: participant.id, trackId: body.trackId });
    await emitPartyState(participant.partyId);
    res.status(201).json({ state: await getPartyState(participant.partyId) });
  }),
);

app.put(
  "/api/participants/:participantId/ranking",
  asyncHandler(async (req, res) => {
    const body = updateRankingSchema.parse(req.body);
    const participant = await prisma.participant.findUniqueOrThrow({ where: { id: req.params.participantId } });
    if (participant.token !== body.participantToken) {
      res.status(403).json({ message: "Participant token does not match." });
      return;
    }
    await replaceRanking(participant.id, body.trackIds);
    await emitPartyEvent(participant.partyId, "ranking:updated", { participantId: participant.id });
    await emitPartyState(participant.partyId);
    res.json({ state: await getPartyState(participant.partyId) });
  }),
);

app.post(
  "/api/parties/:partyId/playback/start",
  asyncHandler(async (req, res) => {
    const { participantToken } = playbackCommandSchema.parse(req.body);
    await requireHost(req.params.partyId, participantToken);
    await startNextTrack(req.params.partyId);
    await emitPartyState(req.params.partyId);
    res.json({ state: await getPartyState(req.params.partyId) });
  }),
);

app.post(
  "/api/parties/:partyId/playback/advance",
  asyncHandler(async (req, res) => {
    const { participantToken } = playbackCommandSchema.parse(req.body);
    await requireHost(req.params.partyId, participantToken);
    await advanceTrack(req.params.partyId);
    await emitPartyState(req.params.partyId);
    res.json({ state: await getPartyState(req.params.partyId) });
  }),
);

app.post(
  "/api/parties/:partyId/finalize",
  asyncHandler(async (req, res) => {
    const { participantToken } = playbackCommandSchema.parse(req.body);
    await requireHost(req.params.partyId, participantToken);
    await finalizeParty(req.params.partyId);
    await emitPartyState(req.params.partyId);
    await emitPartyEvent(req.params.partyId, "party:finalized");
    res.json({ state: await getPartyState(req.params.partyId) });
  }),
);

app.post(
  "/api/discord/interactions",
  asyncHandler(async (_req, res) => {
    res.status(501).json({
      message: "Discord interaction verification is handled by the @nero/discord-bot process in private beta.",
    });
  }),
);

app.get(
  "/api/discord/guilds/:guildId/party",
  asyncHandler(async (req, res) => {
    requireBotRequest(req);
    const link = await prisma.discordGuildLink.findUnique({ where: { guildId: req.params.guildId } });
    if (!link?.partyId) {
      res.status(404).json({ message: "No Nero room is linked to this Discord server." });
      return;
    }
    res.json({ state: await getPartyState(link.partyId) });
  }),
);

app.post(
  "/api/discord/guilds/:guildId/party",
  asyncHandler(async (req, res) => {
    requireBotRequest(req);
    const partyId = String(req.body.partyId ?? "");
    const party = await findParty(partyId);
    const link = await prisma.discordGuildLink.upsert({
      where: { guildId: req.params.guildId },
      create: { guildId: req.params.guildId, partyId: party.id },
      update: { partyId: party.id },
    });
    res.status(201).json({ link, state: await getPartyState(party.id) });
  }),
);

app.post(
  "/api/desktop/device-link",
  asyncHandler(async (req, res) => {
    const deviceName = String(req.body.deviceName ?? "Nero overlay").slice(0, 80);
    const platform = String(req.body.platform ?? "desktop").slice(0, 40);
    const device = await prisma.desktopDevice.create({ data: { deviceName, platform } });
    res.status(201).json({ deviceId: device.id });
  }),
);

io.on("connection", (socket) => {
  socket.on("party:subscribe", async ({ partyCode, participantToken }: { partyCode: string; participantToken?: string }) => {
    const party = await findParty(partyCode).catch(() => null);
    if (!party) {
      socket.emit("party:error", { message: "Room not found." });
      return;
    }
    socket.join(roomName(party.code));
    if (participantToken) {
      await prisma.participant.updateMany({
        where: { partyId: party.id, token: participantToken },
        data: { isPresent: true },
      });
    }
    socket.emit("party:state", await getPartyState(party.id));
  });

  socket.on("presence:heartbeat", async ({ participantToken }: { participantToken: string }) => {
    await prisma.participant.updateMany({ where: { token: participantToken }, data: { isPresent: true } });
  });

  socket.on("audio:ready", async ({ participantToken, audioReady }: { participantToken: string; audioReady: boolean }) => {
    const update = await prisma.participant.updateMany({ where: { token: participantToken }, data: { audioReady } });
    if (update.count > 0) {
      const participant = await prisma.participant.findFirst({ where: { token: participantToken } });
      if (participant) await emitPartyState(participant.partyId);
    }
  });

  socket.on("reaction:send", async (payload: unknown) => {
    const parsed = reactionSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit("party:error", { message: "Reaction could not be sent." });
      return;
    }
    const participant = await prisma.participant.findFirst({ where: { token: parsed.data.participantToken } });
    if (!participant) return;
    const reaction = await prisma.reaction.create({
      data: {
        partyId: participant.partyId,
        participantId: participant.id,
        trackId: parsed.data.trackId,
        type: parsed.data.type,
      },
    });
    await emitPartyEvent(participant.partyId, "reaction:sent", reaction);
    await emitPartyState(participant.partyId);
  });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  log.error(error);
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  res.status(400).json({ message });
});

server.listen(env.PORT, () => {
  log.info(`Nero Party server listening on http://localhost:${env.PORT}`);
});

async function getPartyState(codeOrId: string): Promise<PartyState> {
  const party = await findParty(codeOrId);
  const playback = await prisma.playbackState.findUnique({ where: { partyId: party.id } });
  const [participants, tracks, savedTracks, ranking, reactions, ballots] = await Promise.all([
    prisma.participant.findMany({ where: { partyId: party.id }, orderBy: { joinedAt: "asc" } }),
    prisma.track.findMany({ where: { partyId: party.id }, include: { submittedBy: true }, orderBy: { queuePosition: "asc" } }),
    prisma.savedTrack.findMany({ where: { participant: { partyId: party.id } } }),
    prisma.rankingEntry.findMany({ where: { participant: { partyId: party.id } }, orderBy: { rank: "asc" } }),
    prisma.reaction.findMany({ where: { partyId: party.id }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.ballot.findMany({ where: { partyId: party.id }, include: { ranks: true } }),
  ]);

  const sharedTracks: Track[] = tracks.map((track) => ({
    id: track.id,
    partyId: track.partyId,
    sourceType: track.sourceType as Track["sourceType"],
    sourceId: track.sourceId,
    title: track.title,
    artist: track.artist,
    artworkUrl: track.artworkUrl,
    streamUrl: track.streamUrl,
    durationSeconds: track.durationSeconds,
    queuePosition: track.queuePosition,
    submittedByParticipantId: track.submittedByParticipantId,
    submittedByName: track.submittedBy.displayName,
    status: track.status as Track["status"],
    createdAt: track.createdAt.toISOString(),
  }));

  const sharedBallots: Ballot[] = ballots.map((ballot) => ({
    participantId: ballot.participantId,
    submittedAt: ballot.submittedAt.toISOString(),
    ranks: ballot.ranks.map((rank) => ({ trackId: rank.trackId, rank: rank.rank })),
  }));

  const serverNow = new Date();
  const positionSeconds =
    playback?.isPlaying && playback.startedAt
      ? Math.max(0, Math.floor((serverNow.getTime() - playback.startedAt.getTime()) / 1000))
      : playback?.positionSeconds ?? 0;

  return {
    party: {
      id: party.id,
      code: party.code,
      title: party.title,
      mode: party.mode as PartyState["party"]["mode"],
      status: party.status as PartyState["party"]["status"],
      settings: parseSettings(party.settings),
      createdAt: party.createdAt.toISOString(),
    },
    participants: participants.map(mapParticipant),
    tracks: sharedTracks,
    playback: {
      partyId: party.id,
      currentTrackId: playback?.currentTrackId,
      startedAt: playback?.startedAt?.toISOString(),
      pausedAt: playback?.pausedAt?.toISOString(),
      serverNow: serverNow.toISOString(),
      positionSeconds,
      isPlaying: playback?.isPlaying ?? false,
    },
    savedTracks: savedTracks.map((saved) => ({
      id: saved.id,
      participantId: saved.participantId,
      trackId: saved.trackId,
      createdAt: saved.createdAt.toISOString(),
    })),
    ranking: ranking.map((entry) => ({ participantId: entry.participantId, trackId: entry.trackId, rank: entry.rank })),
    reactions: reactions.map((reaction) => ({
      id: reaction.id,
      partyId: reaction.partyId,
      participantId: reaction.participantId,
      trackId: reaction.trackId,
      type: reaction.type as Reaction["type"],
      createdAt: reaction.createdAt.toISOString(),
    })),
    winners: party.status === "finalized" ? scoreBallots(sharedTracks, sharedBallots) : [],
  };
}

function mapParticipant(participant: Awaited<ReturnType<typeof prisma.participant.findMany>>[number]): Participant {
  return {
    id: participant.id,
    partyId: participant.partyId,
    userId: participant.userId,
    displayName: participant.displayName,
    role: participant.role as Participant["role"],
    source: participant.source as Participant["source"],
    token: participant.token,
    isPresent: participant.isPresent,
    audioReady: participant.audioReady,
    joinedAt: participant.joinedAt.toISOString(),
  };
}

async function findParty(codeOrId: string) {
  const party = await prisma.party.findFirst({ where: { OR: [{ id: codeOrId }, { code: codeOrId.toUpperCase() }] } });
  if (!party) throw new Error("Party not found.");
  return party;
}

async function requireParticipant(partyId: string, token: string) {
  const participant = await prisma.participant.findFirst({ where: { partyId, token } });
  if (!participant) throw new Error("Participant not found for this party.");
  return participant;
}

async function requireHost(partyId: string, token: string) {
  const participant = await requireParticipant(partyId, token);
  if (participant.role !== "host") {
    throw new Error("Only the host can control playback.");
  }
  return participant;
}

async function replaceRanking(participantId: string, trackIds: string[]) {
  const ranks = normalizeRanking(trackIds);
  await prisma.$transaction([
    prisma.rankingEntry.deleteMany({ where: { participantId } }),
    ...(ranks.length
      ? [
          prisma.rankingEntry.createMany({
            data: ranks.map((rank) => ({ participantId, trackId: rank.trackId, rank: rank.rank })),
          }),
        ]
      : []),
  ]);
}

async function startSpotifyTrackForParty(
  partyId: string,
  track: { id: string; sourceType: string; sourceId: string } | null,
  positionSeconds = 0,
) {
  if (!track || track.sourceType !== "spotify") return { startedCount: 0, failureCount: 0, failures: [] as string[] };
  const uri = track.sourceId.startsWith("spotify:") ? track.sourceId : `spotify:track:${track.sourceId}`;
  const listenerConnections = await prisma.listenerSpotifyConnection.findMany({ where: { partyId } });
  const legacyHostConnection = listenerConnections.length ? null : await prisma.spotifyConnection.findUnique({ where: { partyId } });
  const connections = legacyHostConnection ? [legacyHostConnection] : listenerConnections;

  if (!connections.length) {
    await logEvent(partyId, "spotify.playback_skipped", { trackId: track.id, uri, reason: "no_connected_listeners" });
    return {
      startedCount: 0,
      failureCount: 1,
      failures: ["Connect Spotify from at least one listener, open Spotify on that device, then start again."],
    };
  }

  const failures: string[] = [];
  let startedCount = 0;
  for (const connection of connections) {
    try {
      const accessToken = await getSpotifyAccessTokenForConnection(connection);
      await spotify.playUri(accessToken, uri, connection.deviceId, positionSeconds * 1000);
      startedCount += 1;
    } catch (error) {
      failures.push(getErrorMessage(error));
    }
  }

  await logEvent(partyId, "spotify.playback_started", { trackId: track.id, uri, startedCount, failureCount: failures.length });
  return { startedCount, failureCount: failures.length, failures };
}

async function getSpotifyAccessTokenForConnection(connection: {
  id?: string;
  partyId: string;
  participantId?: string;
  accessToken: string;
  refreshToken: string;
  scope: string | null;
  expiresAt: Date;
}): Promise<string> {
  if (connection.expiresAt.getTime() - Date.now() > 60_000) {
    return connection.accessToken;
  }

  const tokens = await spotify.refreshAccessToken(connection.refreshToken);
  const data = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? connection.refreshToken,
    scope: tokens.scope ?? connection.scope,
    expiresAt: new Date(tokens.expiresAt),
  };
  const updated = connection.participantId
    ? await prisma.listenerSpotifyConnection.update({ where: { participantId: connection.participantId }, data })
    : await prisma.spotifyConnection.update({ where: { partyId: connection.partyId }, data });
  return updated.accessToken;
}

async function startNextTrack(partyId: string) {
  const nextTrack = await prisma.track.findFirst({ where: { partyId, status: "queued" }, orderBy: { queuePosition: "asc" } });
  if (!nextTrack) {
    await prisma.party.update({ where: { id: partyId }, data: { status: "voting" } });
    await prisma.playbackState.update({ where: { partyId }, data: { currentTrackId: null, isPlaying: false, positionSeconds: 0 } });
    await logEvent(partyId, "party.voting", {});
    return;
  }

  assertTrackHasPlayableSource(nextTrack);
  const spotifyPlayback = await startSpotifyTrackForParty(partyId, nextTrack);
  assertSpotifyPlaybackStarted(nextTrack, spotifyPlayback);
  await prisma.$transaction([
    prisma.party.update({ where: { id: partyId }, data: { status: "live" } }),
    prisma.track.update({ where: { id: nextTrack.id }, data: { status: "playing" } }),
    prisma.playbackState.update({
      where: { partyId },
      data: { currentTrackId: nextTrack.id, startedAt: new Date(), pausedAt: null, isPlaying: true, positionSeconds: 0 },
    }),
  ]);
  await logEvent(partyId, "playback.started", { trackId: nextTrack.id });
}

async function advanceTrack(partyId: string) {
  const nextTrack = await prisma.track.findFirst({ where: { partyId, status: "queued" }, orderBy: { queuePosition: "asc" } });
  assertTrackHasPlayableSource(nextTrack);
  const spotifyPlayback = await startSpotifyTrackForParty(partyId, nextTrack);
  assertSpotifyPlaybackStarted(nextTrack, spotifyPlayback);
  const playback = await prisma.playbackState.findUnique({ where: { partyId } });

  if (!nextTrack) {
    await prisma.$transaction([
      ...(playback?.currentTrackId
        ? [prisma.track.update({ where: { id: playback.currentTrackId }, data: { status: "played" } })]
        : []),
      prisma.party.update({ where: { id: partyId }, data: { status: "voting" } }),
      prisma.playbackState.update({ where: { partyId }, data: { currentTrackId: null, isPlaying: false, positionSeconds: 0 } }),
    ]);
    await logEvent(partyId, "party.voting", {});
    return;
  }

  await prisma.$transaction([
    ...(playback?.currentTrackId
      ? [prisma.track.update({ where: { id: playback.currentTrackId }, data: { status: "played" } })]
      : []),
    prisma.party.update({ where: { id: partyId }, data: { status: "live" } }),
    prisma.track.update({ where: { id: nextTrack.id }, data: { status: "playing" } }),
    prisma.playbackState.update({
      where: { partyId },
      data: { currentTrackId: nextTrack.id, startedAt: new Date(), pausedAt: null, isPlaying: true, positionSeconds: 0 },
    }),
  ]);
  await logEvent(partyId, "playback.advanced", { trackId: nextTrack.id });
}

function assertTrackHasPlayableSource(track: { sourceType: string; streamUrl: string | null } | null) {
  if (!track || track.sourceType === "spotify" || track.streamUrl) return;
  throw new Error("This track does not have a playable browser audio URL. Add another source.");
}

function assertSpotifyPlaybackStarted(
  track: { sourceType: string } | null,
  playback: { startedCount: number; failureCount: number; failures: string[] },
) {
  if (!track || track.sourceType !== "spotify" || playback.startedCount > 0) return;

  const message =
    playback.failures.find(Boolean) ??
    (playback.failureCount > 0
      ? "Spotify playback failed for every linked listener."
      : "Connect Spotify from at least one listener, open Spotify on that device, then start again.");
  throw new Error(message);
}

async function finalizeParty(partyId: string) {
  const participants = await prisma.participant.findMany({ where: { partyId } });
  const rankings = await prisma.rankingEntry.findMany({ where: { participant: { partyId } }, orderBy: { rank: "asc" } });
  await prisma.$transaction([prisma.ballot.deleteMany({ where: { partyId } })]);

  for (const participant of participants) {
    const participantRanks = rankings.filter((rank) => rank.participantId === participant.id).slice(0, 3);
    if (participantRanks.length === 0) continue;
    await prisma.ballot.create({
      data: {
        partyId,
        participantId: participant.id,
        ranks: {
          create: participantRanks.map((rank) => ({ trackId: rank.trackId, rank: rank.rank })),
        },
      },
    });
  }

  await prisma.party.update({ where: { id: partyId }, data: { status: "finalized" } });
  await prisma.playbackState.update({ where: { partyId }, data: { currentTrackId: null, isPlaying: false, positionSeconds: 0 } });
  await logEvent(partyId, "party.finalized", {});
}

async function emitPartyState(partyId: string) {
  const state = await getPartyState(partyId);
  io.to(roomName(state.party.code)).emit("party:state", state);
  io.to(roomName(state.party.code)).emit("playback:sync", state.playback);
}

async function emitPartyEvent(partyId: string, eventName: string, payload?: unknown) {
  const party = await findParty(partyId);
  io.to(roomName(party.code)).emit(eventName, payload);
}

function roomName(code: string) {
  return `party:${code.toUpperCase()}`;
}

async function logEvent(partyId: string, type: string, payload: unknown) {
  await prisma.eventLog.create({ data: { partyId, type, payload: JSON.stringify(payload) } });
}

async function makeUniquePartyCode(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, "N").slice(0, 6);
    const existing = await prisma.party.findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new Error("Could not allocate a unique room code.");
}

function allowCorsOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
  if (!origin || origin === env.CLIENT_URL || origin === env.PUBLIC_WEB_URL || isLocalWebOrigin(origin)) {
    callback(null, true);
    return;
  }
  callback(null, false);
}

function isLocalWebOrigin(origin: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin);
}

function parseSettings(settings: string): PartySettings {
  return { ...defaultPartySettings(), ...(JSON.parse(settings) as Partial<PartySettings>) };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function withSpotifyResult(baseUrl: string, result: "connected" | "error") {
  const url = new URL(baseUrl);
  url.searchParams.set("spotify", result);
  return url.toString();
}

function requireBotRequest(req: Request) {
  if (!env.DISCORD_BOT_SECRET) return;
  const expected = `Bearer ${env.DISCORD_BOT_SECRET}`;
  if (req.headers.authorization !== expected) {
    throw new Error("Discord bot authorization failed.");
  }
}

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export { putTrackInTopThree };
