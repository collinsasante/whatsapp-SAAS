import type { ExpoConfig, ConfigContext } from 'expo/config';

const APP_ENV = process.env.APP_ENV ?? 'development';
const IS_PRODUCTION = APP_ENV === 'production';
const IS_STAGING = APP_ENV === 'staging';

const apiUrl =
  process.env.API_URL ??
  (IS_PRODUCTION
    ? 'https://api.verzchat.com/api/v1'
    : IS_STAGING
    ? 'https://staging-api.verzchat.com/api/v1'
    : 'http://localhost:3001/api/v1');

const appIdentifier = IS_PRODUCTION
  ? 'com.verzchat.mobile'
  : IS_STAGING
  ? 'com.verzchat.mobile.staging'
  : 'com.verzchat.mobile.dev';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_PRODUCTION ? 'VerzChat' : IS_STAGING ? 'VerzChat (Staging)' : 'VerzChat (Dev)',
  slug: 'verzchat',
  version: '1.0.0',
  ios: {
    ...config.ios,
    bundleIdentifier: appIdentifier,
  },
  android: {
    ...config.android,
    package: appIdentifier,
  },
  extra: {
    ...config.extra,
    apiUrl,
    appEnv: APP_ENV,
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? config.extra?.eas?.projectId ?? 'your-eas-project-id',
    },
  },
  updates: {
    url: `https://u.expo.dev/${process.env.EAS_PROJECT_ID ?? 'your-eas-project-id'}`,
    fallbackToCacheTimeout: 0,
    checkAutomatically: IS_PRODUCTION ? 'ON_LOAD' : 'ON_ERROR_RECOVERY',
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
});
