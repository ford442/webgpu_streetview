# Releasing

## Version scheme

[SemVer 2.0](https://semver.org), one version for the whole app, held in `package.json` (`npm version … --no-git-tag-version`
keeps `package-lock.json` in step). It reaches the running app as `__SV__.build.version` and `build/build-info.json`.

| State | `version` | Git tag |
| --- | --- | --- |
| Release train open (Issues 1–4 of the 1.0 sequence) | `1.0.0-rc.0` | — |
| Release candidate N (Issue 5 cuts it from the closing commit) | `1.0.0-rc.N` | `v1.0.0-rc.N` |
| Production | `1.0.0` | `v1.0.0` |
| After that | patch `1.0.x` for fixes, minor `1.x.0` for features, major only for a break in a URL flag, the share-session protocol or stored data | `v1.x.y` |

A deployed build is identified by its **commit**, not its version: `sha` in `build-info.json` is what `verify:live` compares.
The version says which release train it belongs to; `dirty: true` and a `sha` that is not a tagged commit mean "not a release".

## Cutting a release candidate

1. On the closing commit of the release sequence: `npm version 1.0.0-rc.N --no-git-tag-version`, commit via PR.
2. `Verify` and `build-wasm-emscripten` green on `main`.
3. Deploy workflow → target `test`; its last step (`verify:live`) must pass for the commit.
4. `git tag -a v1.0.0-rc.N <sha> && git push origin v1.0.0-rc.N`.
5. Production (`go`) deploys the same SHA that passed on `test`.

Do not cut an RC until Issues #383–#386 are closed with their State of the App
reports. Each RC must pass the production smoke and the applicable viewport,
state, browser, and GPU checks on `test`; any fix requires a new RC tag and a
repeat of those checks. A successful upload alone is not a release gate.

## Production release record

Before deploying, record the previous production `build-info.json` SHA and the
known-good tag that resolves to it. Also name the release owner (the person
authorized to start the rollback) and record the RC and production Deploy run
URLs. Do not start a production deploy until the rollback rehearsal below has
passed on `test`, the Maps key referrer allowlist includes `go.1ink.us`, and
the production environment secrets are confirmed. Never put secret values in
the record.

After the `go` deploy, check the deployed SHA, COOP/COEP and
`crossOriginIsolated`, service-worker cache id, Maps authentication, and the
live production smoke report. Follow the runbook in
[`PRODUCTION_SMOKE.md`](./PRODUCTION_SMOKE.md). Keep the release under
observation for 24 hours with the production nightly probe and a manual check.
Publish the State of the App report with the release evidence, including
screenshots at 1920×1080 and 390×844 and of the cabin, trip, and fallback
screens.

## Rollback and test rehearsal

Rollback triggers are a failed live smoke, a rise in console errors, Maps
authentication failure, or a billing anomaly. The named release owner starts
the rollback immediately; target a verified restoration within 15 minutes of
the rollback decision. If the target cannot be met, escalate through the
production incident channel and keep the release marked as impaired.

Before production, rehearse this on `test` and retain both Deploy run links and
the live verification evidence:

1. Deploy the RC to `test` and confirm its SHA and smoke result.
2. Re-run the Deploy workflow with target `test`, selecting the recorded
   previous known-good tag as the workflow ref.
3. Confirm `build-info.json` reports the previous SHA and the service worker
   reports the cache id stamped into that previous build. Confirm the page
   loads the matching WASM and shaders, and that live verification passes.

For a production rollback, repeat step 2 with target `go`, using the same
previous known-good tag, then run `verify:live` and the production smoke
against `https://go.1ink.us/streetview/`. The versioned service worker should
activate the cache stamped into that build and remove stale app caches; verify
the observed cache id rather than assuming it. Record the SHA, tag, owner,
decision time, Deploy run, verification result, and completion time for both
the rehearsal and any real rollback. Do not mark the rehearsal complete until
it has actually passed.

## Release notes

Prepare the v1.0.0 release description from
[`RELEASE_NOTES_1.0.0.md`](./RELEASE_NOTES_1.0.0.md), then publish the GitHub
Release only after the production SHA and live checks match the release tag.
Keep the RC deployments and their smoke evidence linked from the release
record.
