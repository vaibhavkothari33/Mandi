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
