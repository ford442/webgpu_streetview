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
