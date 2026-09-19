# Changelog

All notable changes to Verz (VerzChat) are documented here. The canonical,
live "current version" is served by the app itself at `GET /api/v1/public/version`
(backed by the `app_versions` table) — this file is the human-readable history.
See [VERSIONING.md](./VERSIONING.md) for how releases are created.

## [Unreleased]

Changes shipped to staging/production since 2.0.0 that have not yet been
recorded as a release. Group these into the next release's changelog when
that release is created (see VERSIONING.md) — don't record them here in the
meantime.

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
