import { settingsManager } from './settings';
import fs from 'fs-extra';
import { windowManager } from './window';
import { dialog } from 'electron';
import os from 'os';
import cp from 'child_process';

export const clientManager = (() => {
  /**
   * Triggered by the Frontend. Allows us to choose a Directory
   * where the Client will be installed.
   */
  const chooseDirectory = async (cb: () => void) => {
    const result = await dialog.showOpenDialog(windowManager.get(), {
      title: 'Choose Client Directory',
      properties: ['openDirectory'],
    });

    let dir = result.filePaths[0];

    /** Pressed Cancel. */
    if (dir === undefined) {
      windowManager
        .get()
        .webContents.send(
          'invalid-install-directory-chosen',
          'Must choose a directory.'
        );
      return;
    }

    if (isEmpty(dir)) {
      windowManager
        .get()
        .webContents.send(
          'invalid-install-directory-chosen',
          'Chosen Directory is empty and could not be a World of Warcraft directory. Due to bandwidth constraints we require you to provide your own 3.3.5a enUS client.'
        );
      return;
    }

    if (!isWarcraftDirectory(dir)) {
      windowManager
        .get()
        .webContents.send(
          'invalid-install-directory-chosen',
          'Chosen Directory is not a World of Warcraft directory.'
        );
      return;
    }

    if (!isCorrectLocale(dir)) {
      windowManager
        .get()
        .webContents.send(
          'invalid-install-directory-chosen',
          'Invalid World of Warcraft Locale - enUS Required.'
        );
      return;
    }

    /** All other contitions not met, default to valid. */
    windowManager.get().webContents.send('valid-install-directory-chosen', dir);
    setClientDirectory(dir);
    cb();
    return;
  };

  /**
   * Sets and saves the Client Directory we're using.
   * @param path The full path to the Client.
   * @returns this
   */
  const setClientDirectory = (path: string) => {
    settingsManager.storage().set('clientDirectory', path);
  };

  /**
   * Gets the Directory for where we're keeping our Client.
   * @returns The Directory.
   */
  const getClientDirectory = (): string => {
    return settingsManager.storage().get('clientDirectory');
  };

  /**
   * Checks to see if we have a Client Directory Set.
   */
  const hasClientDirectory = (): boolean => {
    return getClientDirectory() !== '';
  };

  /**
   * Given a Directory it will check to see if it is a Warcraft
   * Directory based on whether it has a Data subdir and
   * specific MPQ.
   * @param path The Directory we're checking.
   */
  const isWarcraftDirectory = (path: string): boolean => {
    const checks: Array<string> = [
      'Data\\',
      'Data\\common.MPQ',
      'Data\\common-2.MPQ',
      'Data\\expansion.MPQ',
      'Data\\lichking.MPQ',
      'Data\\patch.MPQ',
      'Data\\patch-2.MPQ',
      'Data\\patch-3.MPQ',
    ];
    const isLinux = os.platform() === 'linux';
    const isMac = os.platform() === 'darwin';

    const checks_unix: Array<string> = [
      'Data/',
      'Data/common.MPQ',
      'Data/common-2.MPQ',
      'Data/expansion.MPQ',
      'Data/lichking.MPQ',
      'Data/patch.MPQ',
      'Data/patch-2.MPQ',
      'Data/patch-3.MPQ',
    ];

    let valid: boolean = true;
    const checksToUse = isLinux || isMac ? checks_unix : checks;

    checksToUse.forEach((check) => {
      if (!valid) return;

      if (!fs.existsSync(`${path}\\${check}`)) valid = false;
    });

    return valid;
  };

  /**
   * Check to see if a Client Directory is empty.
   * @param path Path we're checking.
   */
  const isEmpty = (path: string): boolean => {
    return fs.readdirSync(path).length === 0;
  };

  /**
   * Check to see if a Client Directory may require UAC prompt.
   * @param path Path we're checking.
   */
  const requiresElevation = (path: string): boolean => {
    const isLinux = os.platform() === 'linux';
    const isMac = os.platform() === 'darwin';
    if (isLinux || isMac) {
      return false; // UAC is not applicable on Linux or Mac
    }
    return (
      path.includes('C:\\Program Files (x86)') ||
      path.includes('C:\\Program Files')
    );
  };

  /**
   * Checks to see if the Warcraft Directory provided is
   * of the locale enUS.
   * @param path The directory we're checking.
   */
  const isCorrectLocale = (path: string): boolean => {
    const isLinux = os.platform() === 'linux';
    const isMac = os.platform() === 'darwin';
    const isunix = isLinux || isMac;

    const unixPath = `${path}/Data/enUS/`;
    const unixmpq = `${path}/Data/enUS/locale-enUS.MPQ`;
    /** enUS Locale Doesn't Exist. */
    if (
      isunix
        ? !fs.existsSync(unixPath)
        : !fs.existsSync(`${path}\\Data\\enUS\\`)
    ) {
      return false;
    }

    /** Double check with an MPQ. */
    if (
      isunix
        ? !fs.existsSync(unixmpq)
        : !fs.existsSync(`${path}\\Data\\enUS\\locale-enUS.MPQ`)
    ) {
      return false;
    }

    return true;
  };

  /**
   * Attempts to open the WoW Client Exe.
   */
  const open = () => {
    const exe = 'Project-Epoch.exe';
    const path = `${getClientDirectory()}\\${exe}`;
    const unixPath = `${getClientDirectory()}/${exe}`;
    const unixCache = `${getClientDirectory()}/Cache`;
    let isUnix = os.platform() === 'linux' || os.platform() === 'darwin';

    /** Clean Cache. */
    fs.removeSync(isUnix ? unixCache : `${getClientDirectory()}\\Cache`);

    cp.exec(isUnix ? `"${unixPath}"` : `"${path}"`);
  };

  return {
    chooseDirectory,
    getClientDirectory,
    hasClientDirectory,
    isWarcraftDirectory,
    requiresElevation,
    open,
  };
})();
