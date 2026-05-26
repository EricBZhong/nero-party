# Design Reference Mockups

These are direction-finding mockups, not production UI assets. Some outputs include placeholder catalog details, album art, or platform-adjacent visuals. Treat the images as composition and interaction references only.

## Mockup Set

| Flow | Local file |
| --- | --- |
| Focus listening room | `01-focus-room.png` |
| Companion remote | `02-companion-remote.png` |
| Add song modal | `03-add-song-modal.png` |
| Top 3 drawer | `04-top3-drawer.png` |
| Final reveal | `05-final-reveal.png` |
| Discord Activity | `06-discord-activity.png` |
| Desktop overlay | `07-desktop-overlay.png` |
| Create/join setup | `08-create-join.png` |

## Hater Read

- The strongest references are `01-focus-room.png`, `03-add-song-modal.png`, `04-top3-drawer.png`, and `07-desktop-overlay.png`.
- `01-focus-room.png` solves the core problem: it makes the current song the room, with queue and ranking as supporting layers instead of dashboard panels.
- `03-add-song-modal.png` is the right product move. Submission should be a modal/command flow over the party, not a permanent right rail.
- `04-top3-drawer.png` clarifies the ranking interaction: private Top 3, listened history, current song callout, and save-as-ranking behavior.
- `07-desktop-overlay.png` is the cleanest proof that the background-use case can be real without becoming a dashboard.
- `05-final-reveal.png` has the right event energy, but the placeholder content is too close to real catalog/album art. Rebuild the concept with neutral placeholder tracks.
- `06-discord-activity.png` is directionally useful for button hierarchy, but should be simplified so bot messages do not dominate the Activity.
- `08-create-join.png` is too close to a setup dashboard. Keep the live room preview idea, but reduce settings density.

## Implementation Takeaways

- Make Focus Mode a full-bleed live room with a dominant now-playing stage.
- Move submit/search/upload into an `Add song` modal or command palette.
- Move manual ranking into a drawer/sheet that can open from Focus or Companion Mode.
- Treat the right rail as optional context, not the main product structure.
- Keep Companion Mode as a small remote with only current song, Save, Put in Top 3, and current Top 3.
- Build Finale as a reveal scene, not a results table.
- Do not use fake artist art in-product. Use uploaded artwork, Audius metadata artwork, or neutral placeholders only.

## Acceptance Bar

- The demo follows the reference direction in composition, mood, component shape, and motion language.
- The demo does not use generated mock songs, artists, album art, people, logos, or fake platform content.
- Every surface still uses real Nero Party state and real product actions.
- Focus Mode reads as a live room, not a dashboard.
- Add Song behaves like a modal flow, not a permanent admin sidebar.
- Top 3 behaves like a private drawer/remote flow.
- Discord and desktop overlay routes feel first-class rather than reused web panels.
- A strong-hire demo opens with a richer seeded party state, proves the final reveal, and includes restrained motion polish for saves, queue movement, Top 3 updates, reactions, and reveal.
- Seeded demo playback uses a local rights-safe generated WAV endpoint, not YouTube extraction or hidden catalog rebroadcasting.
