# Versioning

Verz uses [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`) for
every production release. This document is the source of truth for how that
works in this repo — read it before cutting a release.

## Source of truth

The application version is **not** the `"version"` field in any `package.json`
(every workspace package still says `1.0.0` — that's an unused npm-workspace
placeholder, not a release marker, and isn't wired to anything). The real,
live version is a row in the `app_versions` table (`apps/backend/prisma/schema.prisma`),
served publicly at:

```
GET /api/v1/public/version
```

The frontend already reads this on every page load (`apps/frontend/src/components/shared/Sidebar.tsx`)
and shows it as `v{version}` in the sidebar. Nothing else needs to duplicate
the version number by hand.

Related, separate concepts — don't conflate these with the app version:

| Concept | Where it lives | Independent of app version? |
|---|---|---|
| App version | `app_versions` table, `GET /api/v1/public/version` | — |
| API version | `/api/v1/...` URL prefix (`app.setGlobalPrefix('api/v1')` in `main.ts`) | Yes — a PATCH/MINOR app release does not require a new API version |
| Database migrations | `apps/backend/prisma/migrations/*` (timestamped, not semver) | Yes — a migration is not a version bump |
| Mobile app version/build | `apps/mobile/app.config.ts` (`version`), iOS `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION`, Android `versionName`/`versionCode` | Yes — mobile has its own release cadence through the App Store / Play Store; don't force-sync it to the web app's version |

## Current version

As of this writing, `2.0.0` is the latest recorded release (seeded by
migration `20260521300000_feature_flags_versioning`). Every feature/fix
shipped since then has **not** been recorded as a new release — see
`CHANGELOG.md`'s `[Unreleased]` section. The next release should bump from
`2.0.0` based on what's actually in that unreleased set (PATCH/MINOR/MAJOR —
see rules below).

## SemVer rules

- **PATCH** (`2.0.0 → 2.0.1`): bug fixes, security fixes, small corrections,
  performance fixes, internal-only changes with no user-facing functional change.
- **MINOR** (`2.0.1 → 2.1.0`): new backward-compatible features or functionality.
- **MAJOR** (`2.1.0 → 3.0.0`): breaking API/architecture changes, removal of
  existing public functionality, anything that requires users or integrations
  to change how they interact with the system.
- Prerelease identifiers for unreleased/testing versions: `2.1.0-alpha.1`,
  `2.1.0-beta.1`, `2.1.0-rc.1`. Never arbitrary strings like `v2-final` or
  `latest`.

Don't bump the version per commit or per PR. Group meaningful changes into a
release when you're actually about to ship it — see `CHANGELOG.md`'s
`[Unreleased]` section for what's accumulated since the last release.

## Creating a release

1. Decide the next version number from the rules above, based on what's in
   `CHANGELOG.md`'s `[Unreleased]` section.
2. Move that `[Unreleased]` content into a new dated section in
   `CHANGELOG.md`, e.g. `## [2.1.0] - 2026-09-19`.
3. Record the release in the database via the admin API
   (`POST /api/v1/platform-admin/releases`, requires a `SUPER_ADMIN`
   platform-admin JWT):

   ```bash
   curl -X POST https://verzchat.com/api/v1/platform-admin/releases \
     -H "Authorization: Bearer <platform-admin JWT>" \
     -H "Content-Type: application/json" \
     -d '{
       "version": "2.1.0",
       "isLatest": true,
       "description": "Short summary of this release",
       "changelog": {
         "features": ["..."],
         "fixes": ["..."],
         "breaking": []
       }
     }'
   ```

   Setting `isLatest: true` automatically clears the flag on the previous
   version and is what makes `GET /api/v1/public/version` (and the sidebar)
   show the new number immediately.

4. Tag the release in git and push the tag:

   ```bash
   git tag v2.1.0
   git push origin v2.1.0
   ```

5. (Optional, once actually deployed) log the deployment for audit/traceability:

   ```bash
   curl -X POST https://verzchat.com/api/v1/platform-admin/releases/deployments \
     -H "Authorization: Bearer <platform-admin JWT>" \
     -H "Content-Type: application/json" \
     -d '{
       "version": "2.1.0",
       "commitHash": "'"$(git rev-parse HEAD)"'",
       "branch": "main",
       "environment": "production"
     }'
   ```

Other admin endpoints, for reference (all under `platform-admin/releases`,
all guarded by `PlatformAdminGuard`):

- `GET /platform-admin/releases` — list every recorded version.
- `PATCH /platform-admin/releases/:id` — edit an existing release's
  description/changelog/channel, or flip which one `isLatest`.
- `GET /platform-admin/releases/deployments?environment=` — audit trail of
  what was deployed, when, to which environment.

## Docker / deployment

Production deploys are **not** registry/image-tag based — `.github/workflows/deploy.yml`
SSHes into the VPS and `infra/scripts/deploy.sh` does a `git pull` + rebuild +
hot-swap of the built `dist/` into the already-running container (see that
script's comments). There is no Docker image registry in this pipeline, so
image tags like `app:2.1.0` don't apply here the way they would in a
registry-based deploy. Traceability instead comes from:

- The git tag (`v2.1.0`) matching the deployed commit.
- The `deployment_logs` table, if you log the deployment (step 5 above) —
  it records the exact `commitHash`/`branch`/`environment`/timestamp.

If this deploy architecture changes to a registry-based one in the future,
tag images with the exact release version (`app:2.1.0`), not solely `latest`.

## Git tags

Convention: `vMAJOR.MINOR.PATCH` (e.g. `v2.1.0`), created manually per release
(not automated in CI):

```bash
git tag v2.1.0
git push origin v2.1.0
```
