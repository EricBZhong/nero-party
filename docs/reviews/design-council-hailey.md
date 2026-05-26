# Design Council + Hailey Review

## Brief

Surface: web Focus Mode, web Companion Mode, Discord Activity/bot, and Electron overlay.

User job: listen to full songs with friends, save songs, maintain a Top 3 while multitasking, and lock a final ballot.

Constraints: one shared `PartyState`, server-authoritative playback/ranking, uploads plus Audius only, explicit audio unlock, responsive web, Discord iframe, and always-on-top overlay without game injection.

Delivery: production private-beta scaffold with docs, release scripts, and local demo.

## Independent Directions

Product Planner: one source of truth. All surfaces subscribe to the same Socket.IO room and mutate ranking/saves through REST. Companion Mode keeps the background flow to current song, Save, Top 3, and current ballot.

Emil: tactile but restrained. Queue, Top 3, save, and reveal get short state feedback; repeated hotkey actions stay instant.

Impeccable: Nero-native live-room aesthetic. Dark livestream stage, green live accent, confident type, no admin table chrome.

Taste Skill: memorable shape. The product reads as a live layer that expands into a room and collapses into a remote, not a generic dashboard.

## Synthesis

Nero Live Layer: a full live room for active listening and a compact remote for background use. The server owns playback and ranking, while the web, Discord, and desktop shell are distribution surfaces over the same model.

## Approval Gates

### Web

Status: approved for private beta demo.

- No dashboard smell: Focus Mode is stage-first, with queue and people as live rails.
- Audio unlock is explicit and persistent in the top bar.
- Queue is constrained to a rail, with playing state visually distinct.
- Save and Top 3 are separate verbs with separate feedback.
- Ranking accepts one-click insert, drag reorder, and move buttons.

Remaining non-blockers:

- Real Discord OAuth is still a release integration task.
- Upload artwork extraction is not implemented locally.

### Discord

Status: approved with external setup blockers.

- Slash commands are grouped under `/nero`.
- Message buttons use obvious labels: Save, Top 3, Open Activity, Show Queue.
- Bot copy is intentionally short and mostly ephemeral.
- Voice worker rejects hidden video-platform audio.

Remaining non-blockers:

- Activity identity needs real Discord Embedded App SDK configuration.
- Voice playback must be manually verified in the test server after credentials exist.

### Overlay

Status: approved with signing blockers.

- `Alt+X` / `Option+X` hotkey toggles the overlay.
- Fallback hotkey notice is surfaced in the web layer.
- Overlay uses `showInactive`, always-on-top, opacity controls, tray controls, deep links, and click-through collapse.
- The app explicitly avoids graphics API hooks and game injection.

Remaining non-blockers:

- Auto-update publish target is not configured.
- macOS notarization and Windows Authenticode require external certificates.

## Hailey Complaints Resolved

- "This looks like admin software": resolved by making the now-playing stage the first object, not a dashboard table.
- "I do not know if audio is working": resolved with a persistent audio-ready/unlock control.
- "Save vs Top 3 sounds like the same thing": resolved by button labels and feedback copy.
- "Dragging only is annoying while multitasking": resolved with one-click Top 3 and move buttons.
- "Bot spam will get muted": resolved by keeping utility responses ephemeral where possible.
- "Overlay stealing focus while gaming is a dealbreaker": resolved with `showInactive`, tray control, and click-through collapsed state.

## Shipping Rule

No P0/P1 design or user-friction blocker remains in the local implementation. Remaining work is external distribution setup: credentials, hosted infra, Discord configuration, and signing/notarization.
