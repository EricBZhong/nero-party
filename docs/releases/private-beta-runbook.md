# Nero Party Private Beta Runbook

## Release Bar

Private beta means a real web URL, a configured Discord app in the test server, signed desktop installers for macOS and Windows, and a documented source policy. Public app-store, public Discord App Directory, and mainstream catalog licensing are out of scope.

## Source Policy

- Approved full-song sources: user uploads and Audius stream API.
- Optional host queue: Spotify can queue tracks through the host's Spotify account, but Nero does not rebroadcast Spotify audio.
- Future fallback: visible YouTube embed only, with user-visible platform playback.
- Not allowed: YouTube extraction, Lavalink ripping, hidden audio from video platforms, or rebroadcasting catalog audio without a rights deal.
- Bot voice playback: allowed for uploads with explicit room playback grant; Audius requires policy review before broad distribution; Spotify playback stays inside the host's Spotify client.

## Web

1. Set `VITE_PUBLIC_API_URL` to the production API URL.
2. Deploy `apps/web` to Vercel or Cloudflare Pages.
3. Configure routes:
   - `/party/:code` for web rooms.
   - `/discord/:code` for Discord Activity iframe.
   - `/companion/:code` for desktop overlay.
4. Verify:
   - Create room.
   - Join in second tab.
   - Unlock audio.
   - Add Audius track.
   - Upload audio.
   - Optional: connect host Spotify and add a host-queued track.
   - Save and Top 3 actions.
   - Finalize scoring.

## API And Realtime

1. Deploy `apps/server` to Fly.io or Render with a persistent Node process.
2. Use Postgres via Supabase or Neon.
3. Move uploads to Supabase Storage or R2/S3 before non-local beta.
4. Add Upstash Redis before multiple API instances.
5. Set:
   - `DATABASE_URL`
   - `CLIENT_URL`
   - `PUBLIC_API_URL`
   - `PUBLIC_WEB_URL`
   - `AUDIUS_API_BASE`
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - `SPOTIFY_REDIRECT_URI`
   - `DISCORD_BOT_SECRET`
6. Run Prisma migration in the release environment. For local SQLite demos, use `npm run prisma:push` after setting an absolute `DATABASE_URL`.
7. Add Sentry DSN, log drain, and uptime check.

## Discord Activity

1. Create Discord application.
2. Configure Embedded App SDK settings and allowed origin for the deployed web app.
3. Point Activity URL to `/discord/:code` or a channel-context bootstrap route.
4. Install privately in the beta server.
5. Keep the app out of the public App Directory until bot voice/source policy has been reviewed.

Manual checks:

- Activity launches inside Discord.
- Discord identity joins/creates a room.
- Companion Mode fits iframe constraints.
- Buttons are not spammy and use clear labels.
- Permission failures show plain recovery copy.

## Discord Bot

1. Set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, optional `DISCORD_GUILD_ID`, `NERO_API_URL`, `NERO_WEB_URL`, and `DISCORD_BOT_SECRET`.
2. Register slash commands:
   ```bash
   npm run commands:register --workspace @nero/discord-bot
   ```
3. Run bot worker:
   ```bash
   npm run start --workspace @nero/discord-bot
   ```
4. Verify `/nero create`, `/nero join`, `/nero now`, `/nero queue`, `/nero open`, `/nero save`, `/nero top3`, and `/nero end`.
5. Voice playback worker must reject `youtube_embed` and only stream approved upload/Audius sources.

## Spotify Host Queue

1. Create a Spotify Developer app.
2. Add the API callback as an allowed redirect URI:
   ```text
   http://127.0.0.1:3000/api/spotify/callback
   ```
   Use the deployed API callback for a hosted demo.
3. Set `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REDIRECT_URI`.
4. Use a Spotify Premium host account that is allowlisted while the Spotify app is in development mode.
5. In Nero, the host clicks `Connect Spotify` from Host controls.
6. Open this web room or Spotify on the playback device before pressing `Play`; Spotify returns a no-active-device error otherwise.

## Desktop Overlay

1. Build the Electron app:
   ```bash
   npm run dist:mac --workspace @nero/desktop
   npm run dist:win --workspace @nero/desktop
   ```
2. macOS:
   - Use Apple Developer ID certificate.
   - Enable hardened runtime.
   - Notarize `.dmg` with Apple notarization.
   - Staple notarization ticket.
3. Windows:
   - Use an Authenticode code-signing certificate.
   - Build NSIS installer.
   - Configure auto-update publish channel.
4. Verify:
   - `Alt+X` / `Option+X` toggles overlay.
   - Fallback shortcut is visible when unavailable.
   - Always-on-top works over windowed/borderless games.
   - Collapse enables click-through.
   - Deep link `nero-party://join?code=ROOM` loads the room.

Important limitation: the overlay does not inject into games or hook graphics APIs.

## Demo Script

1. Host creates "Nero afterhours" in Focus Mode.
2. Guest joins in a second tab and unlocks audio.
3. Host adds one Audius track and one upload.
4. Optional: host connects Spotify and adds one host-queued track on the active Spotify device.
5. Guest uses Companion Mode: Save, Top 3, then rearranges Top 3 from listened history.
6. Discord `/nero now` shows the current song and buttons.
7. Desktop overlay opens `/companion/:code`, then collapses with the hotkey.
8. Host advances, then finalizes.
9. Finale reveals top tracks with 5/3/1 scoring.

## External Blockers

- Discord application credentials and beta server access.
- Production Postgres, storage, Redis, and deployed URLs.
- Apple Developer ID and notarization account.
- Windows code-signing certificate.
- Spotify Premium test account, allowlisted Spotify app users, and active playback device.
- Audius production policy review for broad bot voice playback.
