# Changelog

All notable changes to Verz (VerzChat) are documented here. The canonical,
live "current version" is served by the app itself at `GET /api/v1/public/version`
(backed by the `app_versions` table) — this file is the human-readable history.
See [VERSIONING.md](./VERSIONING.md) for how releases are created.

## [Unreleased]

Changes shipped to staging/production since 2.3.0 that have not yet been
recorded as a release. Group these into the next release's changelog when
that release is created (see VERSIONING.md) — don't record them here in the
meantime.

## [2.3.0] - 2026-09-23

### Added
- Native mobile refresh-token auth flow, replacing the web-cookie-based session model on iOS/Android
- Mobile: push notifications, Commerce, Team management, and real avatar upload
- Mobile: app-wide light/dark theme system, plus a Contact Us page
- Analytics overview extended with customer, resolution, calls, and CSAT metrics (web + mobile)

### Fixed
- Fixed a privilege-escalation vulnerability that let a workspace member grant themselves or others a higher role than their own, including OWNER
- Fixed WhatsApp and Facebook Messenger inbound webhook signature verification being unconfigured in production, which could allow forged inbound messages
- Fixed channel connection credentials (WhatsApp/Facebook access tokens) not being encrypted at rest in production
- Fixed an unauthenticated file-upload/serve gap that could allow a stored cross-site-scripting attack via the media library
- Fixed the server refusing to start in production with a default/placeholder authentication secret, instead of silently running insecurely
- Removed an unrestricted image-proxy configuration that could be used to process attacker-supplied remote images
- Fixed dead API/socket hostnames in the mobile app after a backend domain change

### Changed
- Production now refuses to start if critical authentication secrets are missing or left at their default values

## [2.2.0] - 2026-09-20

### Added
- WhatsApp via QR (unofficial linked-device) connection is now fully working end-to-end
- Facebook Messenger channel integration

### Fixed
- Fixed WhatsApp-web session events failing silently with 404s due to a missing API route prefix
- Fixed WhatsApp Web QR pairing failing on every attempt due to a stale WhatsApp protocol version
- Fixed a Docker volume-naming bug that could silently orphan data on service rebuild
- Fixed a production-wide outage caused by services splitting across two Docker networks after a rebuild
- Excluded internal testing/evaluation data from real Orders and Revenue views
- Added a missing authorization check on an internal AI testing endpoint

### Changed
- Developer/testing tools (Testing Center, Test Chat, Evaluation Runs) are no longer visible in production
- WhatsApp-web sessions now recover cleanly from an expired QR code instead of retrying silently
- Added protection against two service instances ever running the same WhatsApp-web session concurrently

## [2.1.0] - 2026-07-18

Recorded retroactively — this release predates the changelog/versioning process set up in this repo, reconstructed from the release record already in the database.

### Added
- Platform admin: users grouped by workspace with click-to-expand, all tables now clickable

### Fixed
- Fixed a schema drift bug causing intermittent 500 errors across conversations and settings
- Fixed a crash when replying to a deleted or not yet synced message
- Fixed a crash on every inbound WhatsApp emoji reaction
- Fixed a crash when a WhatsApp webhook payload was missing the phone number
- Fixed a race condition that could crash message processing when a contact messaged twice in quick succession
- Fixed inbound images and documents not displaying or downloading correctly
- Fixed workspace filter, search, and sort controls in platform admin not refetching data
- Fixed offline-queued messages being silently lost when local device storage was unavailable

### Changed
- Inbound media and message processing failures now alert immediately instead of failing silently
- Reworked attachment downloads: files open in a new tab on click, download available via right-click
- Deploy pipeline now refuses to run from the wrong git branch, preventing a repeat of a real incident where production silently ran untested code for hours

## [2.0.0] - 2026-05-21

### Added
- Email verification on signup
- 2-step authentication via email OTP
- Knowledge base file upload (PDF, TXT, CSV, MD)
- URL scraping for knowledge base
- Mobile-responsive campaigns, dashboard, and inbox
- Real-time dashboard KPI cards via WebSocket
- Always-visible message read receipts

### Fixed
- Welcome message now fires correctly for contacts with prior outbound messages
- Dashboard KPI cards update in real-time
