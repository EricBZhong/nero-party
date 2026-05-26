import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, globalShortcut, Menu, nativeImage, shell, Tray } from "electron";
import { autoUpdater } from "electron-updater";

interface OverlaySettings {
  accelerator: string;
  opacity: number;
  partyCode: string;
  autoLaunch: boolean;
}

const defaultSettings: OverlaySettings = {
  accelerator: "Alt+X",
  opacity: 0.96,
  partyCode: "",
  autoLaunch: false,
};

const webUrl = process.env.NERO_WEB_URL ?? "http://localhost:5173";
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let collapsed = false;
let clickThrough = false;
let settings: OverlaySettings = defaultSettings;
let registeredAccelerator = "";

app.setName("Nero Party");
app.setAsDefaultProtocolClient("nero-party");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  const deepLink = argv.find((arg) => arg.startsWith("nero-party://"));
  if (deepLink) applyDeepLink(deepLink);
  showOverlay();
});

app.whenReady().then(() => {
  settings = loadSettings();
  app.setLoginItemSettings({ openAtLogin: settings.autoLaunch });
  createWindow();
  createTray();
  registerOverlayShortcut();
  autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  applyDeepLink(url);
  showOverlay();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 430,
    height: 620,
    minWidth: 340,
    minHeight: 220,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    opacity: settings.opacity,
    title: "Nero Party Overlay",
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadURL(companionUrl());
  mainWindow.once("ready-to-show", () => showOverlay());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Nero Party");
  tray.setContextMenu(buildTrayMenu());
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Show Nero", click: showOverlay },
    { label: collapsed ? "Expand overlay" : "Collapse overlay", click: toggleCollapse },
    { label: clickThrough ? "Disable click-through" : "Enable click-through", click: toggleClickThrough },
    { type: "separator" },
    { label: "Shortcut: Alt+X / Option+X", enabled: false },
    { label: "Use Ctrl+Shift+X", click: () => rebindShortcut("CommandOrControl+Shift+X") },
    { label: "Use Alt+X", click: () => rebindShortcut("Alt+X") },
    { type: "separator" },
    { label: "Opacity 100%", click: () => setOpacity(1) },
    { label: "Opacity 86%", click: () => setOpacity(0.86) },
    { label: "Opacity 72%", click: () => setOpacity(0.72) },
    { type: "separator" },
    {
      label: settings.autoLaunch ? "Disable auto-launch" : "Enable auto-launch",
      click: () => {
        settings.autoLaunch = !settings.autoLaunch;
        saveSettings(settings);
        app.setLoginItemSettings({ openAtLogin: settings.autoLaunch });
        tray?.setContextMenu(buildTrayMenu());
      },
    },
    {
      label: "Open in browser",
      click: () => {
        shell.openExternal(companionUrl()).catch(() => undefined);
      },
    },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  ]);
}

function registerOverlayShortcut() {
  globalShortcut.unregisterAll();
  registeredAccelerator = settings.accelerator;
  const ok = globalShortcut.register(settings.accelerator, toggleOverlay);
  if (!ok) {
    registeredAccelerator = "CommandOrControl+Shift+X";
    const fallbackOk = globalShortcut.register(registeredAccelerator, toggleOverlay);
    showHotkeyNotice(fallbackOk ? `Alt+X was unavailable. Using ${registeredAccelerator}.` : "Global shortcut registration failed. Use the tray menu.");
  }
}

function rebindShortcut(accelerator: string) {
  settings.accelerator = accelerator;
  saveSettings(settings);
  registerOverlayShortcut();
  tray?.setContextMenu(buildTrayMenu());
  showHotkeyNotice(`Overlay shortcut set to ${accelerator}.`);
}

function toggleOverlay() {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showOverlay();
  }
}

function showOverlay() {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.showInactive();
}

function toggleCollapse() {
  if (!mainWindow) return;
  collapsed = !collapsed;
  if (collapsed) {
    mainWindow.setSize(230, 78);
    mainWindow.setOpacity(Math.min(settings.opacity, 0.82));
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    clickThrough = true;
  } else {
    mainWindow.setSize(430, 620);
    mainWindow.setOpacity(settings.opacity);
    mainWindow.setIgnoreMouseEvents(false);
    clickThrough = false;
  }
  tray?.setContextMenu(buildTrayMenu());
}

function toggleClickThrough() {
  if (!mainWindow) return;
  clickThrough = !clickThrough;
  mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
  tray?.setContextMenu(buildTrayMenu());
}

function setOpacity(opacity: number) {
  settings.opacity = opacity;
  saveSettings(settings);
  mainWindow?.setOpacity(opacity);
  tray?.setContextMenu(buildTrayMenu());
}

function applyDeepLink(url: string) {
  const parsed = new URL(url);
  const code = parsed.searchParams.get("code") ?? parsed.pathname.replace("/", "");
  if (!code) return;
  settings.partyCode = code.toUpperCase();
  saveSettings(settings);
  mainWindow?.loadURL(companionUrl());
}

function companionUrl() {
  const codePath = settings.partyCode ? `/${encodeURIComponent(settings.partyCode)}` : "";
  return `${webUrl}/companion${codePath}?source=overlay`;
}

function showHotkeyNotice(message: string) {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent("nero-overlay-notice",{detail:${JSON.stringify(message)}}))`).catch(() => undefined);
}

function settingsPath() {
  return path.join(app.getPath("userData"), "overlay-settings.json");
}

function loadSettings(): OverlaySettings {
  try {
    return { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(nextSettings: OverlaySettings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(nextSettings, null, 2));
}

export { companionUrl, registeredAccelerator };
