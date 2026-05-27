# Frontend Rewrite Summary

**Branch:** `rewrite/polished-demo`
**Build status:** Clean (`npm run build --workspace @nero/web`)

---

## What Changed

### Architecture

The monolithic 2,300-line `App.tsx` has been decomposed into **16 focused components**:

| Component | Responsibility |
|-----------|---------------|
| `App.tsx` | Slim shell: routing, state, socket, audio, flash |
| `Entry.tsx` | Create/Join screen with room settings |
| `FocusRoom.tsx` | Main room layout (3-column on desktop) |
| `NowPlaying.tsx` | Central now-playing stage with waveform |
| `QueuePreview.tsx` | Left rail — compact queue sidebar |
| `BallotCard.tsx` | Right rail — your Top 3 preview |
| `LeaderboardCard.tsx` | Right rail — live leaderboard |
| `HostControls.tsx` | Playback controls for host |
| `AddSongModal.tsx` | Search/upload modal |
| `QueueDrawer.tsx` | Full queue drawer |
| `RankingDrawer.tsx` | Private Top 3 ranking flow |
| `Finale.tsx` | Theatrical podium reveal |
| `OverlayShell.tsx` | Companion/overlay surface |
| `OverlayPreview.tsx` | In-room overlay preview |
| `shared/TrackArtwork.tsx` | Reusable artwork component |
| `shared/SpotifyButton.tsx` | Spotify connect button |

### Visual Design

- **Dark concert aesthetic** — #050806 base, green (#31F176) accent
- **Stage-first layout** — dominant now-playing area with waveform visualization
- **Responsive** — 3-column on XL, single column on mobile, drawer-based modals
- **Animations** — page-rise, modal-rise, drawer-slide, live-pulse, bar-bounce
- **Reduced motion** — respects `prefers-reduced-motion`

### API Contract Preservation

- `api.ts` keeps the existing backend contract.
- Host controls call the implemented `start`, `advance`, and `finalize` endpoints directly.
- Spotify connection state is read through the existing Spotify status endpoint.
- `socket.ts` — completely unchanged
- All existing API functions remain untouched
- All shared types consumed as-is

### Zero New Dependencies

No new packages added. Uses only what was already in `package.json`.

---

## Remaining Production Gaps

1. **No real drag-and-drop** in RankingDrawer — it uses explicit move-up/move-down controls to avoid adding a dependency right before submission.
2. **Waveform** — still visual rather than driven by Web Audio analysis.
3. **Spotify playback** — connection status is visible, but Spotify audio still depends on each listener having an active connected Spotify device.
4. **Native overlay** — the web overlay is a product preview; Electron remains the production path for global hotkey, click-through, tray/menu-bar, and signed installers.

---

## How to Use

```bash
git checkout rewrite/polished-demo
cd apps/web
npm run dev
```

The app will serve at `http://localhost:5173` (or whatever Vite picks).
