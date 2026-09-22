import * as Haptics from 'expo-haptics';

// Wrapped defensively: expo-haptics is a native module that only works after
// a native rebuild links it in. Calling it against a binary built before
// that rebuild can throw synchronously (not just reject), which a bare
// .catch() wouldn't catch -- so every call here is wrapped in try/catch too.
function safeCall(fn: () => Promise<void>) {
  try {
    fn().catch(() => undefined);
  } catch {
    // native module not linked yet -- no-op until the next native rebuild
  }
}

export function tapLight() {
  safeCall(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export function tapMedium() {
  safeCall(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

export function notifySuccess() {
  safeCall(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function notifyError() {
  safeCall(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
