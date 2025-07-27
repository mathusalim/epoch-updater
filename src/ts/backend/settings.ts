import Store, { Schema } from 'electron-store';

/**
 * Create our Settings Structure with explicit types for TS.
 */
interface SettingStructure {
  clientDirectory: string;
  environment: string;
  key: string;
  cdn: boolean;
  cdnProvider: string;
}

/**
 * Actually create the Settings Store Structure and assign defaults.
 */
const schema: Schema<SettingStructure> = {
  clientDirectory: {
    type: 'string',
    default: '',
  },
  environment: {
    type: 'string',
    default: 'production',
  },
  key: {
    type: 'string',
    default: '',
  },
  cdn: {
    type: 'boolean',
    default: true,
  },
  cdnProvider: {
    type: 'string',
    default: 'cloudflare',
  },
};

/**
 * return an object with a storage method that returns the electron-store instance.
 */
export const settingsManager = (() => {
  const store = new Store<SettingStructure>({
    migrations: {
      '1.1.0': (store) => {
        store.set('cdnProvider', 'cloudflare');
      },
      '1.0.13': (store) => {
        store.set('cdn', true);
      },
    },
    schema: schema,
  });
  return {
    storage: (): Store<SettingStructure> => store,
  };
})();
