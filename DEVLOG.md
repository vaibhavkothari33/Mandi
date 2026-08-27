# Development log

What broke, why, and how it was resolved.

## 2026-08-27

**`node:sqlite` types missing at build.**
`next build` failed with `TS2307: Cannot find module 'node:sqlite'`. The scaffold pinned
`@types/node@^20`; `node:sqlite` landed in Node 22. Runtime was fine, only typings were stale.
Upgraded to `@types/node@^22` to match the runtime.

**Scripts could not resolve `@/` path aliases.**
`node scripts/seed.ts` failed with `ERR_MODULE_NOT_FOUND`. The `@/*` alias is a bundler
convention that bare Node does not read. Switched `lib/` and `scripts/` to relative imports,
leaving `@/` only in `app/` where Next resolves it.

**Node ESM rejected extensionless imports.**
Relative imports still failed: Node's ESM resolver requires explicit file extensions. Added
`.ts` specifiers plus `allowImportingTsExtensions` in tsconfig, so the same modules load under
both the Next bundler and bare `node`. This keeps the attack harness runnable outside Next.

**`.env.example` silently untracked.**
The scaffold's `.gitignore` contains `.env*`, which swallows the example file. Added an
`!.env.example` negation.

**Hydration mismatch on `<body>`.**
React reported mismatched `data-gr-ext-installed` / `data-new-gr-c-s-check-loaded` attributes.
Both are injected by the Grammarly browser extension before React hydrates. Added
`suppressHydrationWarning` to `<body>`; it is shallow, so genuine mismatches inside the tree
still surface.

## 2026-08-28

**Node type-stripping rejected TypeScript parameter properties.**
`ApiError` used `constructor(readonly status: number, ...)`. Node failed with
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`: strip-only mode deletes type syntax but cannot emit the
field assignments a parameter property implies. Rewrote with explicit fields. Same constraint
rules out enums and namespaces, so the codebase avoids both.

**A stale dev server served a build that predated the checkout routes.**
Every `POST /api/checkout_sessions` returned the 404 page even though `next build` listed the
route. Cause: an earlier server was still bound to port 3000. `pkill -f "next start"` had not
matched it, because on Windows the running process is `node`, not `next`. The same stale
process was holding the old SQLite file open, which had also blocked deleting it earlier.
Now released by port rather than by name via `Get-NetTCPConnection -LocalPort 3000`.

**Test teardown failed with EBUSY on Windows.**
Removing the temp directory threw `EBUSY: resource busy or locked` because the SQLite handle
was still open. Windows will not unlink an open file. Added `close()` to the database client
and call it before cleanup.

**`node --test tests/` treated `helpers.ts` as a test file.**
A shared helper module with no tests failed the run. Narrowed the glob to `tests/*.test.ts`.

**Verification switched from curl to a fetch script.**
Shell pipelines of `curl | node -e` broke on Windows path handling (`/tmp` resolved to `D:\tmp`)
and made empty-variable bugs surface as confusing 308 redirects. Replaced with
`scripts/smoke.ts` using `fetch`, which is cross-platform and reusable as the basis for the
buyer harness.
