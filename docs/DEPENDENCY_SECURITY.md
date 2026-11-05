# Dependency security record

Last reviewed: 2026-11-04 (local `pnpm audit`, no network access to production).

## Closed

- 59 of 73 high/critical advisories closed through `pnpm.overrides` in the root `package.json`
  (multer, axios, follow-redirects, form-data, proxy-addr, body-parser, lodash, ws, socket.io-parser,
  engine.io, js-yaml, brace-expansion, tar, @grpc/grpc-js and several transitive utilities).
- Next.js 14.2.35 -> 15.5.29 (React 19.2.3) closes the Image Optimization RCE, Server Actions DoS/SSRF and
  middleware bypass advisories. Only `JSX` namespace usage needed a code change (`type JSX` import).
  Verified by type-check, production build and a headless-Chromium pass over login, register,
  forgot-password and 16 signed-in routes on desktop and mobile widths: no page errors, no horizontal
  overflow. Remaining console errors were environmental (unseeded plans in the test DB, no WhatsApp
  account connected, `/commerce` is a mobile-only route).

## Closed by patching (2026-11-05)

| Package | Advisories | What was done | How it is verified |
| --- | --- | --- | --- |
| `music-metadata` (inside Baileys) | GHSA-v6c2-xwv6-8xf7, GHSA-8j4c-6x6g-rq3j, GHSA-53v6-4h7p-p4gj, GHSA-jjpr-9cvf-cq55, GHSA-5gfj-9q3v-qfp3, GHSA-f94x-6692-553q | Override to `^11.16.1`. 11.x is ESM-only and Baileys `require()`s it, so Baileys is patched (`patches/@whiskeysockets__baileys@6.17.16.patch`) to load it with a dynamic `import()`, the same way it already loads `audio-decode`. | `apps/whatsapp-web/src/audio-duration.test.ts` runs Baileys' real `getAudioDuration` on MP3, OGG/Opus and hostile bytes. The media upload path also now refuses content that does not match its declared type (an ASF container declared as audio never reaches a parser). |
| `decode-uri-component` 0.2.2 (via `minio` -> `query-string@7`, and Expo Router on mobile) | GHSA-vcc3-ghjq-m6fr, GHSA-qr28-fpjm-wq7f | The fixed releases are ESM-only and crashed the backend suites when forced (the earlier attempt). Instead the 0.2.2 entry point is patched (`patches/decode-uri-component@0.2.2.patch`): well-formed input still uses native `decodeURIComponent`; only the malformed-input fallback, which was quadratic or worse, is replaced by one linear pass. | `apps/backend/src/common/security/decode-uri-component.patch.spec.ts` pins parity with upstream on valid input, the malformed-input behaviour, and linear time on hostile 150 KB inputs (upstream 0.2.2 did not finish a 15 KB one in three minutes). |

Reachability, for the record: the backend only calls `query-string`'s `stringify` (minio building request queries), never `parse`, so the vulnerable decode was not reachable from request input there. Mobile parses deep-link query strings, so it was reachable on the user's own device; the patch applies to both because pnpm patches by package version.

Patching has a maintenance cost. When Baileys or minio move to versions that no longer need these patches, remove the patch and the override together; `pnpm install --frozen-lockfile` fails loudly if a patch stops applying.

## Open (accepted, with reasoning)

None in the shipped server apps at this review. Re-run `pnpm audit --prod` before each release and record anything new here.

## Known build note

`pnpm -r build` at the repo root fails for `packages/theme` and similar (missing
`@whatsapp-platform/tsconfig/library.json`). Those packages are mobile-only and are not part of any server
image; build backend, worker, realtime and frontend with their own scripts (as the Dockerfiles do).

## Process

Re-run `pnpm audit --prod` before each release; new high/critical findings block release unless recorded here
with an exposure argument.
