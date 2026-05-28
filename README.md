# Nero Party

Nero Party is a private-beta music game for full-song listening parties. It is being built around one server-authoritative party state and these surfaces/modules:

- `apps/web`: Focus Mode live room plus an in-room overlay preview.
- `apps/server`: Express, Socket.IO, Prisma, Uploads + Audius playback coordinator, and Spotify listener-device playback.
- `apps/discord-bot`: Parked for now; not part of the current demo surface.
- `apps/desktop`: Electron always-on-top overlay for macOS and Windows.
- `packages/shared`: TypeScript schemas, types, ratings, and scoring.
- `packages/player`: Upload, Audius, and optional Spotify source adapters.

Hard source policy: production full songs come from user uploads, Audius streams, or each listener's own Spotify playback device. Nero does not extract YouTube audio, rip video platforms, or rebroadcast hidden catalog audio.

## Local Setup

Prerequisites:

- Node.js 22+ and npm.
- Google Chrome for the two-client browser E2E test.
- Spotify Premium + a Spotify Developer app only if you want to demo Spotify playback. Upload playback does not need Spotify.

```bash
npm install
cp .env.example .env
# Edit DATABASE_URL to an absolute local SQLite path, for example:
# DATABASE_URL=file:/Users/you/nero-party/apps/server/prisma/dev.db
npm run prisma:generate
npm run prisma:push
npm run dev
```

Local URLs:

- Web: `http://localhost:5173`
- Server: `http://localhost:3000`
- Overlay preview: open from the room's `Overlay` button.

If port `3000` is already taken, change `PORT`, `PUBLIC_API_URL`, `VITE_PUBLIC_API_URL`, `SPOTIFY_REDIRECT_URI`, and `NERO_API_URL` together in `.env`, then restart the dev server. The E2E test also needs `E2E_API_URL` when the API is not on `3000`.

Useful local demo path:

1. Run `npm run dev`.
2. Open `http://localhost:5173`.
3. Create a room, add an upload/Audius/Spotify track, and press Play.
4. Open the same room link in another browser profile or incognito window to verify guest join, save, rating, sync playback, skip, End Game, and playlist export.

## Current Demo Functionality

- Create and join live music rooms by room link/code.
- Realtime multiplayer sync across host and listener clients using Socket.IO.
- Add songs from uploads, Audius search, or Spotify search when configured.
- Browser playback for uploaded audio, plus optional Spotify playback through each listener's own connected Spotify account/device.
- Host playback controls: play/pause, skip to next track, and End Game.
- Synced now-playing state with queue, artwork, progress, elapsed time, and transition state between songs.
- Listener actions: save songs, rate each heard song from `0.0` to `5.0` in `0.1` increments, and export saved songs after the game.
- Results page with winner selection, average ratings, default neutral `3.0` scores for missing ratings, and a scrollable all-ratings section.
- Companion overlay preview for the multitasking use case; native desktop overlay distribution remains a follow-up.

## Environment

`DATABASE_URL=file:./dev.db` is the local default. Production should use Postgres on Supabase or Neon.

Key variables:

- `CLIENT_URL`: browser origin allowed by the API.
- `PUBLIC_API_URL`: public API URL used for upload stream URLs.
- `PUBLIC_WEB_URL` / `NERO_WEB_URL`: web surface used by overlay and follow-up links.
- `AUDIUS_API_BASE`: Audius API base.
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`: Spotify OAuth for listener-device playback. Add the redirect URI in the Spotify Developer Dashboard.
- `SPOTIFY_SCOPES`: defaults to `streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state user-read-currently-playing`. Reconnect Spotify after changing scopes.

## Product Flows

Create Party: host picks title, song cap, total timebox, per-listener submission limit, voting lock window, and allowed sources before starting a focused live room.

Join Party: guests join by web link. Desktop deep links remain a production follow-up.

Full Song Submission: Audius search, Spotify search, or MP3/WAV/FLAC/AAC/MP4 upload when enabled by the host. The API enforces per-listener, room song, source, and total-duration limits. Uploaded files are served by the API locally and should move to Supabase Storage or R2/S3 in production.

Spotify Listener Playback: each listener who wants Spotify audio connects their own Premium, allowlisted Spotify account. The web app creates a Spotify Web Playback SDK browser device when possible, then Nero starts the same track URI on each linked listener device.

Simple Background Flow: the overlay shows now playing, `Save`, and a responsive 0.0-5.0 rating slider.

Full Rating Flow: Focus Mode includes a rating bay where listened songs can be scored in 0.1 increments.

Finale: each played song is scored by average rating. Missing ratings count as a neutral `3.0`, so one perfect rating cannot beat a broadly loved song. Tie-breaks use explicit rating count, then 5.0 ratings, then earlier queue position.

## Visual Direction

These design reference mockups are direction-finding artifacts, not production UI assets. Use them for composition, density, mood, and interaction shape only. Do not ship their placeholder artists, album art, logos, or platform-like content.

The strongest implementation anchors are the Focus listening room, Add song modal, rating drawer, Final reveal, and Desktop overlay. See the full notes in [docs/design/reference-mockups/README.md](docs/design/reference-mockups/README.md).

<table>
  <tr>
    <td width="50%">
      <strong>Focus listening room</strong><br />
      <img src="docs/design/reference-mockups/01-focus-room.png" alt="Focus listening room mockup" width="420" />
    </td>
    <td width="50%">
      <strong>Companion remote</strong><br />
      <img src="docs/design/reference-mockups/02-companion-remote.png" alt="Companion remote mockup" width="420" />
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Add song modal</strong><br />
      <img src="docs/design/reference-mockups/03-add-song-modal.png" alt="Add song modal mockup" width="420" />
    </td>
    <td width="50%">
      <strong>Rating drawer</strong><br />
      <img src="docs/design/reference-mockups/04-top3-drawer.png" alt="Rating drawer mockup" width="420" />
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Final reveal</strong><br />
      <img src="docs/design/reference-mockups/05-final-reveal.png" alt="Final reveal mockup" width="420" />
    </td>
    <td width="50%">
      <strong>Discord Activity</strong><br />
      <img src="docs/design/reference-mockups/06-discord-activity.png" alt="Discord Activity mockup" width="420" />
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Desktop overlay</strong><br />
      <img src="docs/design/reference-mockups/07-desktop-overlay.png" alt="Desktop overlay mockup" width="420" />
    </td>
    <td width="50%">
      <strong>Create and join</strong><br />
      <img src="docs/design/reference-mockups/08-create-join.png" alt="Create and join setup mockup" width="420" />
    </td>
  </tr>
</table>

## Overlay Plan

Current demo path: the room's `Overlay` button opens a web preview of the compact companion surface against a game-like backdrop. This validates the background-use interaction model without pretending it is an OS-level overlay.

Fast web follow-up: Chrome Document Picture-in-Picture can float the compact Nero controls in an always-on-top browser-owned window. This is useful for demoing the feel quickly, but it will not cover global hotkeys, tray/menu-bar presence, click-through behavior, autolaunch, signed installers, or reliable over-game behavior.

Native follow-up: Electron remains the production path for a real macOS/Windows overlay. It should wrap `/companion/:code?source=overlay`, support `nero-party://join?code=ROOM`, provide global `Alt+X` / `Option+X` toggle behavior, collapse into a small click-through pill, expose opacity and tray/menu-bar controls, persist settings, and ship signed installers.

Non-goal: Nero should not inject into games, hook graphics APIs, scrape protected playback, or capture/rebroadcast hidden catalog audio. The overlay is a floating Nero remote over the same server-authoritative party state.

## TODO

- [ ] Tighten the in-room overlay preview so it uses real party state, keeps only now playing, `Save`, rating, collapse state, and the minimum settings needed to prove the concept.
- [ ] Web global overlay follow-up: implement Chrome Document Picture-in-Picture using the same companion/overlay component, with a clear browser-support fallback back to the in-room preview.
- [ ] Native overlay follow-up: keep Electron for production-grade macOS/Windows overlay distribution, including global `Alt+X` / `Option+X`, tray/menu-bar controls, click-through, opacity, deep links, auto-launch, and persisted overlay settings.
- [ ] Overlay validation pass: test over a real game or fullscreen/borderless app, verify focus changes do not break party state, and confirm the collapsed pill does not block gameplay.
- [ ] Mockup implementation pass: translate the strongest references from [docs/design/reference-mockups/README.md](docs/design/reference-mockups/README.md) into the real app, especially `01-focus-room.png`, `03-add-song-modal.png`, `04-top3-drawer.png`, `05-final-reveal.png`, and `07-desktop-overlay.png`.
- [ ] Mockup cleanup rule: do not ship generated fake artists, album art, logos, or platform lookalikes from the mockups; use real uploaded/Audius metadata or neutral placeholders.

## Development Commands

```bash
npm run dev                  # server + web
npm run dev:web              # Vite web app only
npm run dev:server           # Express/Socket.IO API only
npm run dev:desktop          # Electron overlay shell
npm run dev:discord          # Discord bot shell
npm run prisma:generate      # generate Prisma client
npm run prisma:push          # sync local SQLite schema
npm run typecheck            # TypeScript across all workspaces
npm test                     # unit/smoke tests
npm run build                # production build across all workspaces
npm run test:e2e:two-client  # host + guest browser E2E; requires app running
```

Recommended pre-submit check:

```bash
npm run prisma:push
npm run typecheck
npm test
npm run build
```

Two-client E2E check:

```bash
# Terminal 1
npm run dev

# Terminal 2, using the default .env.example API port
npm run test:e2e:two-client

# If your API is on another port, for example 3001:
E2E_API_URL=http://localhost:3001 npm run test:e2e:two-client
```

The E2E script launches or reuses a temporary Chrome profile with DevTools on port `9223`, creates a fresh room, opens isolated host and guest contexts, uploads generated WAV tones, verifies synced browser audio playback, saves and rates as the guest, skips tracks as the host, ends the game, checks default `3.0` scoring, and verifies post-finale playlist export. Use `npm run test:e2e:two-client -- --keep-open` to leave the test tabs open for debugging.

Desktop installers:

```bash
npm run dist:mac --workspace @nero/desktop
npm run dist:win --workspace @nero/desktop
```

Signing, notarization, and Windows code-signing credentials are intentionally external to the repo.

## Production Topology

- Web: Vercel or Cloudflare Pages.
- API/realtime: Fly.io or Render Node service for long-lived Socket.IO.
- DB: Supabase or Neon Postgres.
- Storage: Supabase Storage or R2/S3.
- Redis: Upstash for Socket.IO scaling, rate limits, presence, and jobs.
- Observability: Sentry, structured logs, uptime checks, and basic product analytics.

See [private beta runbook](docs/releases/private-beta-runbook.md) and [Design Council + Hailey review](docs/reviews/design-council-hailey.md).
