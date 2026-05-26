# Nero Party Product Architecture

## Product Shape

Nero Party is one realtime music game with three distribution surfaces:

- Focus Mode: active listening room for a host-led party.
- Companion Mode: compact ranking remote for background use.
- Discord and desktop: entry points into the same party, not separate products.

The invariant is one server-authoritative `PartyState`. Clients never independently decide playback order, ranking validity, or final score.

## Backend Services

### API Server

`apps/server` owns:

- party creation and join tokens
- participants and presence
- track submission
- upload file intake
- optional Spotify OAuth, catalog search, and host queue control
- Audius search proxy
- playback state transitions
- ranking and saved songs
- finale ballot materialization
- Discord guild links
- desktop device links

Local dev uses SQLite for fast setup. Production should use Postgres because party state, ballots, saved tracks, and guild/device links are relational and need auditability.

### Realtime

Socket.IO rooms are keyed by party code:

- `party:state`: full state refresh after meaningful mutations
- `playback:sync`: server-time playback position
- `track:added`: queue insertion hint
- `ranking:updated`: participant ranking hint
- `saved:updated`: saved playlist hint
- `reaction:sent`: transient live reaction
- `presence:changed`: participant availability hint
- `party:finalized`: finale lock

Production multi-instance deployment should add a Redis Socket.IO adapter with Upstash or equivalent.

### Source Adapters

`packages/player` exposes source adapters:

- Uploads: local dev storage now, Supabase Storage or R2/S3 in production.
- Audius: search and stream URL mapping.
- Spotify: optional OAuth token exchange, catalog search, and Add to Queue for the connected host account.

The adapter package intentionally does not provide YouTube extraction.

## Main Models

- `User`: optional durable identity, first with Discord OAuth.
- `Party`: room title, code, mode, status, settings.
- `Participant`: party-scoped identity and anonymous token.
- `Track`: queued/listened song, source metadata, stream URL, submitter.
- `PlaybackState`: current track, start time, server position, play state.
- `Reaction`: live lightweight reactions.
- `SavedTrack`: per-user party playlist.
- `RankingEntry`: current mutable Top 3.
- `Ballot` / `BallotRank`: locked finale snapshot.
- `EventLog`: audit trail.
- `SpotifyConnection`: host account token set for queue control.
- `DiscordGuildLink`: private beta server-to-party link.
- `DesktopDevice`: overlay installs and device links.

## REST API

Implemented:

- `POST /api/parties`
- `GET /api/parties/:code`
- `POST /api/parties/:code/join`
- `GET /api/search/audius?q=`
- `GET /api/search/spotify?q=`
- `GET /api/parties/:id/spotify/status`
- `GET /api/parties/:id/spotify/login`
- `GET /api/spotify/callback`
- `POST /api/uploads/audio`
- `POST /api/parties/:id/tracks`
- `PUT /api/participants/:id/ranking`
- `POST /api/participants/:id/saved-tracks`
- `POST /api/parties/:id/playback/start`
- `POST /api/parties/:id/playback/advance`
- `POST /api/parties/:id/finalize`
- `POST /api/discord/interactions`
- `GET /api/discord/guilds/:guildId/party`
- `POST /api/discord/guilds/:guildId/party`
- `POST /api/desktop/device-link`

## User Flows

### Create Party

1. Host enters room title and host name.
2. Host chooses Focus or Companion default.
3. Server creates party, host participant, playback state, and event log.
4. Client stores participant token locally and subscribes to the Socket.IO room.

### Join Party

1. Guest enters room code or opens a deep link.
2. Server creates or refreshes a participant token.
3. Client receives state and starts presence heartbeat.
4. User explicitly unlocks audio before playback.

### Submit Full Song

1. User searches Audius, selects an upload, or optionally queues Spotify metadata through the host account.
2. Upload endpoint returns a track source payload.
3. Track is added to queue if participant and room limits allow it.
4. Server emits updated state.

### Connect Spotify

1. Host clicks Connect Spotify from Host controls.
2. Server starts OAuth with Spotify playback scopes.
3. Callback stores the host token set in `SpotifyConnection`.
4. Spotify tracks remain metadata-only inside Nero; playback happens on the host's Spotify account.

### Now Playing

1. Host starts or advances playback.
2. If the next track is Spotify-sourced, server first queues it on the connected host Spotify account.
3. Server marks the next queued track as playing and records `startedAt`.
4. Clients sync local audio from server time for playable upload/Audius tracks and show metadata for Spotify-hosted tracks.
4. Reconnects correct drift from `PlaybackState.positionSeconds`.

### Background Ranking

1. Companion Mode shows current song, Save, Top 3, and current ballot.
2. Save writes to `SavedTrack`.
3. Top 3 inserts the track at rank 1 and shifts existing tracks down.
4. Ranking drawer also allows older listened tracks to be brought back.

### Finale

1. Host locks finale.
2. Server snapshots every participant's current Top 3 into ballots.
3. `scoreBallots` applies 5/3/1 and tie-breaks.
4. Winners are returned on party state.

## Mockup Notes

### Focus Mode

The first viewport is a live stage. The current track is oversized, queue and submission are right-side rails, and participant/ranking controls sit below the stage. This keeps the product feeling like a live room instead of analytics software.

### Companion Mode

The compact surface is intentionally one-handed: artwork, title, Save, Top 3, and three ranking slots. It is the shape used by Discord Activity and desktop overlay.

### Desktop Overlay

The Electron shell is a normal always-on-top window. It can be collapsed into a click-through strip and toggled by `Alt+X` / `Option+X`. It does not inject into games.
