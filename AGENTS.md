# Working on envato-cli

The maintained CLI contract is in `src/cli.ts`; browser behavior lives in `src/browser.ts` and `src/services.ts`. Read `README.md` for supported scope and `VALIDATION.md` when assessing claims about real-account behavior.

Run `npm test` for changes to commands, storage, installation or browser adapters. Live tests use the subscriber's account; existing authorization applies, and a new generation requires a bounded credit budget. Preserve unknown submission states rather than replaying a possibly charged request.

The distributable skill source is `skills/envato-cli/SKILL.md`. Change it there, then use `envato skills install --force` to refresh an installed copy after reviewing local edits. Installation targets the caller's directory; launchers must preserve cwd.

The installed `.agents/skills/envato-cli/` copy is ignored in this repository; commit the distributable source instead.

Keep `.envato/`, `artifacts/`, browser profiles and credentials outside commits. The Windows command installer creates user-level shims; updating the repository requires rebuilding `dist/` before those shims run the new code.
