import { app, BrowserWindow, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = process.env.NODE_ENV !== "production";
const rendererDevUrl =
  process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

let mainWindow: BrowserWindow | undefined;

function configureMediaPermissions(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === "media");
    },
  );

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => {
      return permission === "media";
    },
  );
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    title: "Ai Translate",
    show: false,
    backgroundColor: "#f8faf7",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  let revealTimeout: ReturnType<typeof setTimeout> | undefined;

  const clearRevealTimeout = (): void => {
    if (revealTimeout) {
      clearTimeout(revealTimeout);
      revealTimeout = undefined;
    }
  };

  const revealMainWindow = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      clearRevealTimeout();
      return;
    }

    if (mainWindow.isVisible()) {
      clearRevealTimeout();
      return;
    }

    mainWindow.show();
    mainWindow.focus();
  };

  mainWindow.on("closed", () => {
    clearRevealTimeout();
    mainWindow = undefined;
  });

  mainWindow.once("ready-to-show", revealMainWindow);
  mainWindow.webContents.once("did-finish-load", revealMainWindow);
  revealTimeout = setTimeout(revealMainWindow, 3000);

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      console.error(
        `Renderer failed to load: ${errorCode} ${errorDescription}`,
      );
    },
  );

  if (isDevelopment) {
    // Wait a bit for vite to start before loading
    setTimeout(async () => {
      try {
        await mainWindow!.loadURL(rendererDevUrl);
        mainWindow!.webContents.openDevTools({ mode: "detach" });
      } catch (err) {
        console.error("Failed to load renderer URL:", err);
      }
    }, 2000);
    return;
  }

  await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  configureMediaPermissions();
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
