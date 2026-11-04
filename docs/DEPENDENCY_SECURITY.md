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

## Open (accepted, with reasoning)

| Package | Why it remains | Exposure |
| --- | --- | --- |
| `music-metadata` 7.14 (inside baileys) | Pinned by the baileys release; upgrading means moving baileys. | Parses audio duration of files we generate ourselves for outbound sends; not attacker-supplied. Revisit when baileys updates. |
| `decode-uri-component` 0.2.2 (via minio -> query-string 7) | Fix is ESM-only 0.5.x; forcing it crashed backend suites (verified). Override deliberately removed. | Used on object-storage query strings built by our code; not reachable from request input. |

## Known build note

`pnpm -r build` at the repo root fails for `packages/theme` and similar (missing
`@whatsapp-platform/tsconfig/library.json`). Those packages are mobile-only and are not part of any server
image; build backend, worker, realtime and frontend with their own scripts (as the Dockerfiles do).

## Process

Re-run `pnpm audit --prod` before each release; new high/critical findings block release unless recorded here
with an exposure argument.
