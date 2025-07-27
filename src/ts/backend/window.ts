import { app, BrowserWindow } from 'electron';

/**
 * Constant instance of the Window Class.
 */
export const windowManager = (() => {
  let window: BrowserWindow;
  return {
    /**
     * Actually creates the Window for later use.
     * @param entrypoint Typically the Webpack Main entry.
     */
    create: (entrypoint: string, preloader: string): BrowserWindow => {
      window = new BrowserWindow({
        width: 1010,
        height: 680,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        titleBarStyle: 'hidden',
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: preloader,
        },
      });

      window.loadURL(entrypoint);
      window.setMenuBarVisibility(false);

      if (!app.isPackaged) {
        window.webContents.openDevTools({ mode: 'detach' });
      }

      return window;
    },
    /**
     * Get the BrowserWindow instance that was created.
     */
    get: () => {
      if (!window) {
        throw new Error('Window has not been created yet.');
      }
      return window;
    },
  };
})();
