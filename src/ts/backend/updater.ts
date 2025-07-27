import { app, net } from 'electron';
import { windowManager } from './window';
import fs from 'fs';
import { clientManager } from './client';
import { DownloaderHelper } from 'node-downloader-helper';
import md5File from 'md5-file';
import { settingsManager } from './settings';
import isElevated from 'is-elevated';
let log = require('electron-log');

/**
 * The various States of the Updater Process.
 */
export enum UpdateState {
  NONE = 'none',
  SETUP = 'setup',
  GET_MANIFEST = 'get-manifest',
  VERIFYING_INTEGRITY = 'verifying-integrity',
  UPDATE_AVAILABLE = 'update-available',
  DOWNLOADING = 'downloading',
  REQUIRES_ELEVATION = 'requires-elevation',
  DONE = 'done',
}

interface PatchFile {
  Path: string;
  Hash: string;
  Size: number;
  Custom: boolean;
  Urls: Record<string, string>; // Map of provider name -> URL
}

interface Manifest {
  Version: string;
  Uid: string;
  Files: PatchFile[];
  Removals?: string[]; // Optional, per environment
}
/**
 * Updater Object
 */
export const updateManager = (() => {
  let currentState: UpdateState;
  let manifestHost: string = 'updater.project-epoch.net';
  let manifest: Manifest | undefined;
  let updatableFiles: Array<PatchFile> = [];
  let remainingFiles: number = 0;
  let currentDownload: DownloaderHelper;
  let cancelled: boolean = false;

  currentState = UpdateState.NONE;
  /** Dev Mode - Use Local. */
  if (!app.isPackaged) {
    manifestHost = 'updater-api.test';
  }

  /**
   * Gets the Patch Manifest from our updater API.
   */
  const getManifest = () => {
    let environment = app.isPackaged
      ? settingsManager.storage().get('environment')
      : 'development';

    environment = 'production';

    const key = settingsManager.storage().get('key');

    const request = net.request({
      method: 'GET',
      protocol: app.isPackaged ? 'https:' : 'https:',
      hostname: manifestHost,
      path: `/api/v2/manifest?environment=${environment}&internal_key=${key}`,
      redirect: 'error',
    });

    request.on('response', (response) => {
      let result = '';

      response.on('data', (chunk) => {
        result += chunk.toString();
      });

      response.on('end', () => {
        processManifestResponse(JSON.parse(result));
      });
    });

    request.on('error', (error) => {
      onManifestFailure(error);
    });

    request.setHeader('Content-Type', 'application/json');
    request.end();
  };

  /**
   * Fires when we've got a response from the Manifest
   * API endpoint.
   * @param response
   */
  const processManifestResponse = (response: any) => {
    if (response.hasOwnProperty('Version')) {
      onManifestReceived(response);
    } else {
      console.log('Unexpected Response');
      console.log(response);
    }
  };

  /**
   * Fired when we have finished loading the Patch Manifest.
   * @param manifest The Patch Manifest we got.
   */
  const onManifestReceived = (manifest: Manifest) => {
    manifest = manifest;
    checkIntegrity(manifest);
  };

  /**
   * Fired when getting the Manifest Fails.
   */
  const onManifestFailure = (error: Error) => {
    log.error(`Manifest Retrival Failure: ${error.message}`);
  };

  /**
   * Begins the process of checking integrity of game files.
   * @param manifest The Patch Manifest we're using.
   */
  const checkIntegrity = async (manifest: Manifest) => {
    setState(UpdateState.VERIFYING_INTEGRITY);
    updatableFiles = [];

    /** Check UAC */
    const elevated = await isElevated();
    if (
      clientManager.requiresElevation(clientManager.getClientDirectory()) &&
      !elevated
    ) {
      setState(UpdateState.REQUIRES_ELEVATION);

      return;
    }

    windowManager
      .get()
      .webContents.send(
        'client-directory-loaded',
        clientManager.getClientDirectory()
      );

    for (let index = 0; index < manifest.Files.length; index++) {
      let element = manifest.Files[index];
      let localPath = `${clientManager.getClientDirectory()}\\${element.Path}`;

      /** Doesn't Exist. Just Download. */
      if (!fs.existsSync(localPath)) {
        updatableFiles.push(element);
        continue;
      }

      /** Fix readonly flag. */
      const mode = fs.statSync(localPath).mode;
      fs.chmodSync(localPath, mode | 0o666);

      /** Blizzard File - Just check number of bytes. */
      if (!element.Custom) {
        let size = fs.statSync(localPath).size;
        if (element.Size !== size) {
          updatableFiles.push(element);
        }

        continue;
      }

      /** Custom File. Actually Hash Check. */
      await checkHash(element, localPath);
    }

    /** Need to download every file. Must be new. */
    if (updatableFiles.length === manifest.Files.length) {
      downloadUpdates();
      return;
    }

    if (updatableFiles.length > 0) {
      /** Only some files. Must be an update. */
      setState(UpdateState.UPDATE_AVAILABLE);
      windowManager
        .get()
        .webContents.send('version-received', manifest.Version);
    } else {
      setState(UpdateState.DONE);
    }
  };

  /**
   * Generates an MD5 hash for the given file and if not
   * matching then marks as requiring update.
   * @param file Our Patch Manifest File Entry.
   * @param localPath The path on disk for where it is.
   */
  const checkHash = async (file: PatchFile, localPath: string) => {
    await md5File(localPath).then((hash) => {
      if (hash !== file.Hash) {
        updatableFiles.push(file);
      }
    });
  };

  /**
   * Sets our state to Downloading and begins the
   * process of downloading any updates we had
   * remaining.
   */
  const downloadUpdates = async () => {
    setState(UpdateState.DOWNLOADING);
    remainingFiles = updatableFiles.length;
    cancelled = false;

    let cdnProvider = settingsManager.storage().get('cdnProvider');

    log.info(
      `Commencing Download of ${updatableFiles.length} Files Using CDN: ${cdnProvider}`
    );

    for (let index = 0; index < updatableFiles.length; index++) {
      const element = updatableFiles[index];

      /** If we've cancelled don't process any more. */
      if (cancelled) {
        continue;
      }

      /** Figure out filename. */
      let parts = element.Path.split('\\');
      let filename = parts[parts.length - 1];

      /** Figure out Directory. */
      let clientDir = clientManager.getClientDirectory();
      let downloadDir = element.Path.split(filename)[0];
      let directory = `${clientDir}\\${downloadDir}`;

      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }

      await download(
        element.Urls[cdnProvider],
        directory,
        filename,
        index,
        updatableFiles.length
      );
    }

    checkIntegrity(manifest);
  };

  /**
   * Attempts to cancel the current downloads.
   */
  const cancel = async () => {
    cancelled = true;
    await currentDownload.stop();
    checkIntegrity(manifest);
  };

  /**
   * Attempts to download a file from our CDN.
   * @param url The URL of the file we're downloading.
   * @param directory The directory where we should save it.
   * @param filename The filename to give it.
   * @param index And out of all our downloads which is
   * @param total How many total files do we have.
   */
  const download = async (
    url: string,
    directory: string,
    filename: string,
    index: number,
    total: number
  ) => {
    currentDownload = new DownloaderHelper(url, directory, {
      fileName: filename,
      override: true,
      removeOnStop: false,
      removeOnFail: false,
      timeout: 60000,
      resumeIfFileExists: false,
      progressThrottle: 1000,
      retry: {
        maxRetries: 3,
        delay: 10000,
      },
    });

    remainingFiles--;

    currentDownload.on('start', () => {
      log.info(
        `Beginning Download: ${filename} - Remaining: ${remainingFiles}`
      );

      windowManager
        .get()
        .webContents.send(
          'download-started',
          filename,
          remainingFiles,
          index + 1,
          total
        );
    });

    currentDownload.on('progress', (stats) => {
      windowManager
        .get()
        .webContents.send(
          'download-progress',
          stats.total,
          stats.name,
          stats.downloaded,
          stats.progress,
          stats.speed
        );
    });

    currentDownload.on('progress.throttled', (stats) => {
      windowManager
        .get()
        .webContents.send(
          'download-progress-throttled',
          stats.total,
          stats.name,
          stats.downloaded,
          stats.progress,
          stats.speed
        );
    });

    currentDownload.on('error', (stats) => {
      log.error(
        `Download Failed - Message (${stats.message}) - Status (${stats.status}) - Body: (${stats.body})`
      );
      console.log(
        `Message: ${stats.message} - Status: ${stats.status} - Body: ${stats.body}`
      );
    });

    currentDownload.on('end', (stats) => {
      log.info(
        `Download Complete: ${stats.fileName} - Total Size (${
          stats.totalSize
        }) - Disk Size (${stats.onDiskSize}) - Success: ${
          stats.incomplete ? 'False' : 'True'
        }`
      );

      windowManager.get().webContents.send('download-finished');
    });

    currentDownload.on('stop', () => {
      log.info(`Download Stopped`);
    });

    await currentDownload.start();
  };

  /**
   * Sets the latest Updater State and fires it to the Frontend.
   * @param state The new state.
   */
  const setState = (state: UpdateState) => {
    currentState = state;

    refresh();
  };

  /**
   * Forces a Frontend "Refresh" of the Update State by just sending it.
   */
  const refresh = () => {
    windowManager.get().webContents.send('update-state-changed', getState());
  };

  /**
   * Gets our current Update State.
   */
  const getState = (): UpdateState => {
    return currentState;
  };

  return {
    getManifest,
    downloadUpdates,
    cancel,
    setState,
    refresh,
    getState,
  };
})();
