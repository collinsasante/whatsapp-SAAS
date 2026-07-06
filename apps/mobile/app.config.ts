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

const appName = IS_PRODUCTION
  ? 'VerzChat'
  : IS_STAGING
  ? 'VerzChat Staging'
  : 'VerzChat Dev';

const bundleId = IS_PRODUCTION
  ? 'com.verzchat.mobile'
  : IS_STAGING
  ? 'com.verzchat.mobile.staging'
  : 'com.verzchat.mobile.dev';

const easProjectId =
  process.env.EAS_PROJECT_ID ??
  (process.env.EXPO_PUBLIC_PROJECT_ID as string | undefined) ??
  '';

export default ({ config }: ConfigContext): ExpoConfig => {
  const base: ExpoConfig = {
    ...config,
    name: appName,
    slug: 'verzchat',
    version: '1.0.0',
    orientation: 'portrait',
    ios: {
      ...config.ios,
      bundleIdentifier: bundleId,
      supportsTablet: false,
    },
    android: {
      ...config.android,
      package: bundleId,
    },
    extra: {
      ...config.extra,
      apiUrl,
      appEnv: APP_ENV,
      ...(easProjectId && {
        eas: { projectId: easProjectId },
      }),
    },
  };

  // Only wire up OTA updates when a real EAS project ID exists
  if (easProjectId) {
    base.updates = {
      url: `https://u.expo.dev/${easProjectId}`,
      fallbackToCacheTimeout: 0,
      checkAutomatically: IS_PRODUCTION ? 'ON_LOAD' : 'ON_ERROR_RECOVERY',
    };
    base.runtimeVersion = { policy: 'appVersion' };
  }

  return base;
};
