# Frontend quality gate

Run from the repository root after building the shared packages (`pnpm --filter @whatsapp-platform/shared-types build`, then `shared-utils`):

| Check | Command | State on the release candidate (2026-11-05) |
| --- | --- | --- |
| Type check | `pnpm --filter @whatsapp-platform/frontend typecheck` | passes |
| Lint | `pnpm --filter @whatsapp-platform/frontend lint` | 0 errors, 30 warnings (below) |
| Unit and component tests | `pnpm --filter @whatsapp-platform/frontend test` | 1 test passes (`cn`). The `HistorySyncLine` tests live with that feature on `chore/frontend-quality`. |

`next build` ignores type and lint errors (see `next.config.js`), so CI (`.github/workflows/frontend-quality.yml`) is the only gate. Do not rely on the build to catch them.

## Remaining lint warnings

| Rule | Count | Why it stays |
| --- | --- | --- |
| `react/no-unescaped-entities` | 17 | An apostrophe or quote in JSX text. React renders it correctly; this is a style rule set to `warn` on purpose in `.eslintrc.json`. Fixing them means touching 17 copy strings for no behaviour change. |
| `@next/next/no-img-element` | 13 | Avatars and media thumbnails served by our own `/media/serve` route or by a channel provider's CDN. `next/image` would send them through the Next image optimizer, which needs `remotePatterns` for every provider host and was the surface of the Image Optimization advisory the Next 15 upgrade closed. Plain `<img>` is deliberate here. |

## Errors fixed to reach a clean lint

- `app/not-found.tsx` used `<a href="/">` for an internal link; now `next/link`.
- `components/shared/Sidebar.tsx` had an `eslint-disable` for a rule the configuration does not load, which is itself a lint error. The `as any` it excused is replaced with the `Parameters<typeof setAuth>[0]` assertion already used in `login/page.tsx`; the store normalises the role at runtime.
- `eslint-config-next` was still on 14.x while Next is on 15.5; aligned to `^15.5.29`.
