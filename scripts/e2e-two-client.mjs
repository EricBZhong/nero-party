import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const API_URL = process.env.E2E_API_URL ?? "http://localhost:3001";
const CDP_PORT = Number(process.env.E2E_CDP_PORT ?? 9223);
const CHROME_PROFILE = process.env.E2E_CHROME_PROFILE ?? "/private/tmp/nero-party-e2e-chrome";
const DEFAULT_TIMEOUT_MS = 15_000;

const keepOpen = process.argv.includes("--keep-open");

class CdpConnection {
  constructor(url, label) {
    this.url = url;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out opening CDP socket for ${this.label}`)), 5000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(`CDP socket error for ${this.label}: ${event.message ?? "unknown"}`));
      });
    });

    this.ws.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.id) return;
      const waiter = this.pending.get(payload.id);
      if (!waiter) return;
      this.pending.delete(payload.id);
      if (payload.error) {
        waiter.reject(new Error(`${payload.error.message}${payload.error.data ? `: ${payload.error.data}` : ""}`));
        return;
      }
      waiter.resolve(payload.result);
    });
  }

  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error(`CDP socket is not open for ${this.label}`);
    const id = this.nextId++;
    const payload = { id, method, params };
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify(payload));
    return promise;
  }

  close() {
    this.ws?.close();
  }
}

class PageClient extends CdpConnection {
  async init() {
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor(
      () => document.readyState === "complete" || document.readyState === "interactive",
      [],
      `navigation to ${url}`,
    );
  }

  async evaluate(fn, args = []) {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`${this.label} evaluation failed: ${result.exceptionDetails.text}`);
    }
    return result.result?.value;
  }

  async waitFor(fn, args = [], description = "condition", timeoutMs = DEFAULT_TIMEOUT_MS) {
    const started = Date.now();
    let lastError = "";
    while (Date.now() - started < timeoutMs) {
      try {
        const value = await this.evaluate(fn, args);
        if (value) return value;
      } catch (error) {
        lastError = error.message;
      }
      await delay(150);
    }
    throw new Error(`Timed out waiting for ${this.label}: ${description}${lastError ? ` (${lastError})` : ""}`);
  }

  async clickButton(label) {
    return this.evaluate((text) => {
      const buttons = [...document.querySelectorAll("button")];
      const button = buttons.find((candidate) => {
        const copy = `${candidate.textContent ?? ""} ${candidate.getAttribute("aria-label") ?? ""} ${candidate.getAttribute("title") ?? ""}`;
        return copy.toLowerCase().includes(text.toLowerCase());
      });
      if (!button) return false;
      button.click();
      return true;
    }, [label]);
  }

  async clickButtonExact(label) {
    return this.evaluate((text) => {
      const normalize = (value) => value.replace(/\s+/g, " ").trim().toLowerCase();
      const buttons = [...document.querySelectorAll("button")];
      const button = buttons.find((candidate) => {
        const labels = [candidate.textContent ?? "", candidate.getAttribute("aria-label") ?? "", candidate.getAttribute("title") ?? ""].map(normalize);
        return labels.includes(normalize(text));
      });
      if (!button) return false;
      button.click();
      return true;
    }, [label]);
  }

  async audioSnapshot() {
    return this.evaluate(() => {
      const audio = document.querySelector("audio");
      if (!audio) return null;
      return {
        currentTime: audio.currentTime,
        paused: audio.paused,
        readyState: audio.readyState,
        src: audio.currentSrc || audio.src,
      };
    });
  }
}

async function main() {
  await ensureServers();
  const browser = await ensureChrome();
  const created = await createSeededParty();
  const [hostContext, guestContext] = await Promise.all([
    browser.send("Target.createBrowserContext", {}),
    browser.send("Target.createBrowserContext", {}),
  ]);

  let host;
  let guest;
  try {
    host = await createPage(browser, hostContext.browserContextId, "host");
    guest = await createPage(browser, guestContext.browserContextId, "guest");

    await host.navigate(`${BASE_URL}/`);
    await host.evaluate(
      (code, token, url) => {
        localStorage.setItem(`nero-party-token-${code.toUpperCase()}`, token);
        window.location.href = url;
        return true;
      },
      [created.partyCode, created.hostToken, `${BASE_URL}/party/${created.partyCode}`],
    );
    await host.waitFor(
      (title, firstTrack) => document.body.innerText.includes(title) && document.body.innerText.includes(firstTrack),
      [created.title, created.tracks[0].title],
      "host room loaded with queued track",
    );

    await guest.navigate(`${BASE_URL}/party/${created.partyCode}`);
    await guest.waitFor(() => document.body.innerText.includes("Enter room"), [], "guest join form");
    await guest.evaluate((displayName) => {
      const nameInput = [...document.querySelectorAll("input")].find((input) => input.placeholder === "Listener");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(nameInput, displayName);
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }, ["Guest Tab"]);
    await assert(await guest.clickButtonExact("Enter room"), "guest Enter room button was not found");
    await guest.waitFor(
      (title, firstTrack) => document.body.innerText.includes(title) && document.body.innerText.includes(firstTrack),
      [created.title, created.tracks[0].title],
      "guest joined room and received queued track",
    );

    await waitForPartyState(created.partyCode, (state) => state.participants.length === 2, "two participants");

    await Promise.all([primeClientAudio(host), primeClientAudio(guest)]);
    await assert(await host.clickButton("Play"), "host Play button was not found");
    const playingFirst = await waitForPartyState(
      created.partyCode,
      (state) => state.playback.isPlaying && state.tracks.find((track) => track.id === state.playback.currentTrackId)?.title === created.tracks[0].title,
      "first track playing",
    );
    await waitForAudioPlaying(host, created.tracks[0].title);
    await waitForAudioPlaying(guest, created.tracks[0].title);

    const guestParticipant = playingFirst.participants.find((participant) => participant.displayName === "Guest Tab");
    await assert(guestParticipant, "guest participant was not present in party state");
    const firstTrack = playingFirst.tracks.find((track) => track.title === created.tracks[0].title);
    const secondTrack = playingFirst.tracks.find((track) => track.title === created.tracks[1].title);
    await assert(firstTrack && secondTrack, "seeded tracks were missing from party state");

    await assert(await guest.clickButtonExact("Save"), "guest Save button was not found");
    await waitForPartyState(
      created.partyCode,
      (state) => state.savedTracks.some((saved) => saved.participantId === guestParticipant.id && saved.trackId === firstTrack.id),
      "guest saved first track",
    );
    await setRating(guest, 4.2);
    await waitForPartyState(
      created.partyCode,
      (state) => state.ranking.some((entry) => entry.participantId === guestParticipant.id && entry.trackId === firstTrack.id && entry.rating === 4.2),
      "guest rated first track",
    );

    await assert(await host.clickButton("Skip to next track"), "host Skip button was not found");
    await waitForPartyState(
      created.partyCode,
      (state) => state.playback.isPlaying && state.tracks.find((track) => track.id === state.playback.currentTrackId)?.title === created.tracks[1].title,
      "second track playing after skip",
    );
    await waitForAudioPlaying(host, created.tracks[1].title);
    await waitForAudioPlaying(guest, created.tracks[1].title);

    await setRating(guest, 4.6);
    await waitForPartyState(
      created.partyCode,
      (state) => state.ranking.some((entry) => entry.participantId === guestParticipant.id && entry.trackId === secondTrack.id && entry.rating === 4.6),
      "guest rated second track",
    );

    await assert(await host.clickButtonExact("End Game"), "host End Game button was not found");
    const finalized = await waitForPartyState(
      created.partyCode,
      (state) =>
        state.party.status === "finalized" &&
        !state.playback.isPlaying &&
        state.playback.currentTrackId === null &&
        state.winners.length >= 2 &&
        state.winners.every(
          (winner) =>
            winner.defaultRatingCount >= 1 &&
            Math.abs(winner.totalRating - winner.score * winner.ratingCount) < 0.11,
        ),
      "finalized results with default ratings",
    );
    await waitForAudioPaused(host);
    await waitForAudioPaused(guest);
    await host.waitFor(() => document.body.innerText.toLowerCase().includes("all ratings"), [], "all ratings visible");
    await assert(await host.clickButtonExact("Export Playlist"), "finale Export Playlist button was not found");
    await host.waitFor(() => document.body.innerText.includes("Saved songs") && document.body.innerText.includes("Download CSV"), [], "saved songs export drawer");

    await assert(await guest.clickButton("Leave"), "guest Leave button was not found");
    await guest.waitFor(() => document.body.innerText.includes("Leave this listening party?"), [], "leave confirmation modal");
    await assert(await guest.clickButtonExact("Leave room"), "guest confirm Leave room button was not found");
    await guest.waitFor(() => window.location.pathname === "/" && document.body.innerText.includes("Launch room"), [], "guest returned to entry");

    printResult(created, finalized);
  } finally {
    host?.close();
    guest?.close();
    if (!keepOpen) {
      await browser.send("Target.disposeBrowserContext", { browserContextId: hostContext.browserContextId }).catch(() => null);
      await browser.send("Target.disposeBrowserContext", { browserContextId: guestContext.browserContextId }).catch(() => null);
      browser.close();
    }
  }
}

async function ensureServers() {
  await fetchJson(`${API_URL}/health`, undefined, "API health check");
  const webResponse = await fetch(`${BASE_URL}/`);
  if (!webResponse.ok) throw new Error(`Web health check failed with ${webResponse.status}`);
}

async function ensureChrome() {
  let version = await fetchChromeVersion().catch(() => null);
  if (!version) {
    if (process.platform !== "darwin") {
      throw new Error(`No Chrome DevTools endpoint found on ${CDP_PORT}. Start Chrome with --remote-debugging-port=${CDP_PORT}.`);
    }
    spawn(
      "open",
      [
        "-na",
        "Google Chrome",
        "--args",
        `--user-data-dir=${CHROME_PROFILE}`,
        `--remote-debugging-port=${CDP_PORT}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
        `${BASE_URL}/`,
      ],
      { stdio: "ignore", detached: true },
    ).unref();
    const started = Date.now();
    while (!version && Date.now() - started < 10_000) {
      await delay(250);
      version = await fetchChromeVersion().catch(() => null);
    }
  }
  if (!version?.webSocketDebuggerUrl) throw new Error(`Chrome DevTools endpoint on ${CDP_PORT} did not expose a browser websocket.`);
  const browser = new CdpConnection(version.webSocketDebuggerUrl, "browser");
  await browser.connect();
  return browser;
}

async function fetchChromeVersion() {
  return fetchJson(`http://localhost:${CDP_PORT}/json/version`, undefined, "Chrome DevTools version");
}

async function createPage(browser, browserContextId, label) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const targets = await fetchJson(`http://localhost:${CDP_PORT}/json/list`, undefined, "Chrome target list");
  const target = targets.find((candidate) => candidate.id === targetId);
  if (!target?.webSocketDebuggerUrl) throw new Error(`Could not resolve websocket for ${label} tab.`);
  const page = new PageClient(target.webSocketDebuggerUrl, label);
  await page.connect();
  await page.init();
  return page;
}

async function createSeededParty() {
  const title = `Nero e2e ${Date.now().toString(36).slice(-5)}`;
  const created = await fetchJson(`${API_URL}/api/parties`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      hostName: "Host Tab",
      mode: "focus",
      settings: {
        maxSubmissionsPerParticipant: 5,
        maxQueueSize: 8,
        maxDurationMinutes: 5,
        votingLockSeconds: 10,
        allowDiscordVoice: false,
        allowUploads: true,
        allowAudius: true,
        allowSpotify: true,
      },
    }),
  });

  const tracks = [];
  for (const [index, frequency] of [440, 554].entries()) {
    const upload = await uploadTone(`Browser Sync ${index + 1}`, `E2E Tone ${frequency}`, frequency);
    const added = await fetchJson(`${API_URL}/api/parties/${created.state.party.id}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...upload, participantToken: created.participantToken }),
    });
    tracks.push(added.track);
  }

  return {
    title,
    partyCode: created.partyCode,
    partyId: created.state.party.id,
    hostToken: created.participantToken,
    tracks,
  };
}

async function uploadTone(title, artist, frequency) {
  const wav = makeToneWav({ frequency, seconds: 8 });
  const form = new FormData();
  form.set("audio", new File([wav], `${title.toLowerCase().replace(/\s+/g, "-")}.wav`, { type: "audio/wav" }));
  form.set("title", title);
  form.set("artist", artist);
  form.set("durationSeconds", "8");
  return fetchJson(`${API_URL}/api/uploads/audio`, { method: "POST", body: form });
}

function makeToneWav({ frequency, seconds }) {
  const sampleRate = 44_100;
  const samples = Math.floor(sampleRate * seconds);
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples; index += 1) {
    const fadeIn = Math.min(1, index / (sampleRate * 0.04));
    const fadeOut = Math.min(1, (samples - index) / (sampleRate * 0.08));
    const envelope = Math.min(fadeIn, fadeOut);
    const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.24 * envelope;
    view.setInt16(44 + index * 2, sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

async function primeClientAudio(page) {
  await page.evaluate(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    return true;
  });
  await delay(250);
}

async function setRating(page, rating) {
  const changed = await page.evaluate((nextRating) => {
    const input = [...document.querySelectorAll('input[type="range"]')].find((candidate) => candidate.closest(".rating-control"));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, String(nextRating));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, [rating]);
  await assert(changed, `${page.label} rating slider was not found`);
  await delay(500);
}

async function waitForAudioPlaying(page, expectedTitle) {
  await page.waitFor((title) => document.body.innerText.includes(title), [expectedTitle], `${expectedTitle} visible`);
  let first;
  let second;
  const started = Date.now();
  while (Date.now() - started < DEFAULT_TIMEOUT_MS) {
    first = await page.audioSnapshot();
    await delay(650);
    second = await page.audioSnapshot();
    if (first && second && !second.paused && second.currentTime > first.currentTime + 0.1 && second.src.includes("/uploads/")) return second;
  }
  throw new Error(`${page.label} audio did not play for ${expectedTitle}: ${JSON.stringify({ first, second })}`);
}

async function waitForAudioPaused(page) {
  return page.waitFor(() => {
    const audio = document.querySelector("audio");
    return Boolean(audio && audio.paused);
  }, [], "audio paused");
}

async function waitForPartyState(code, predicate, description, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const started = Date.now();
  let state = null;
  while (Date.now() - started < timeoutMs) {
    state = await fetchJson(`${API_URL}/api/parties/${code}`, undefined, `party state for ${code}`);
    if (predicate(state)) return state;
    await delay(200);
  }
  throw new Error(`Timed out waiting for party state: ${description}. Last state: ${JSON.stringify(state?.playback ?? state?.party ?? state)}`);
}

async function fetchJson(url, init, label = url) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${label} failed with ${response.status}: ${body}`);
  }
  return response.json();
}

async function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function printResult(created, finalized) {
  const winner = finalized.winners[0];
  const lines = [
    "two-client e2e passed",
    `room: ${created.partyCode}`,
    `participants: ${finalized.participants.map((participant) => `${participant.displayName}:${participant.role}`).join(", ")}`,
    `winner: ${winner ? `${winner.title} (${winner.score.toFixed(1)} avg, ${winner.explicitRatingCount} explicit, ${winner.defaultRatingCount} default)` : "none"}`,
    `results: ${finalized.winners.map((result) => `${result.title}=${result.score.toFixed(1)}`).join(", ")}`,
  ];
  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
