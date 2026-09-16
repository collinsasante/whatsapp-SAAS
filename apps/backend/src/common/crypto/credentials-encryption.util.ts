// Moved to packages/shared-utils so the worker app's WhatsApp send processors
// (no NestJS DI available there) can share the exact same AES-GCM
// implementation as CredentialsEncryptionService, instead of a second
// implementation drifting into existence. Re-exported from this path so
// every existing backend import (CredentialsEncryptionService, this file's
// own .spec.ts, scripts/encrypt-existing-credentials.ts) keeps working
// unchanged.
export * from '@whatsapp-platform/shared-utils';
