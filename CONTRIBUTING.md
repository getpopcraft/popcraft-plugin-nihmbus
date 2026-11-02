# Contributing

## Commits decide releases

Every commit is a [Conventional Commit](https://www.conventionalcommits.org): `type(scope): summary`. On each push to
`main`, [tishlang/sem](https://github.com/tishlang/sem) reads the commits since the last tag and picks the next
version:

| Type                                                               | Release |
| ------------------------------------------------------------------ | ------- |
| `fix:`, `perf:`                                                    | patch   |
| `feat:`                                                            | minor   |
| `feat!:`, `fix!:` or a `BREAKING CHANGE:` footer                   | major   |
| `docs:`, `ci:`, `chore:`, `refactor:`, `test:`, `build:`, `style:` | none    |

If a change reaches users (the plugin's behavior, its tools, its panel), it is a `fix:` or a `feat:`. CI checks every
pull request's commits with `scripts/check-commits.mjs`.

A change that breaks the [tool contract](docs/tools.md) is a breaking change: bump `EXTENSION_PROTOCOL` in `main.js`
together with `device.protocol` in [the extension](https://github.com/nihmbus/nihmbus-popcraft), and ship both.

## How a release happens

1. **Merge to `main`.** [`release.yml`](.github/workflows/release.yml) lints, tests, and asks sem for the next
   version. With nothing to release it stops.
2. **Prerelease.** It writes the version into `manifest.json`, `main.js` and `package.json`, commits
   `chore(release): vX.Y.Z [skip ci]`, tags `vX.Y.Z`, and publishes a GitHub **prerelease** with the installable
   bundle (`popcraft.nihmbus-X.Y.Z.json`) attached.
3. **Promote.** Try the prerelease (Manage plugins → Install from file…). When it's good, edit the release and
   uncheck **Set as a pre-release**. [`marketplace.yml`](.github/workflows/marketplace.yml) then publishes that
   version to the PopCraft marketplace, where it goes to review before it's listed.

Never edit versions by hand; the release workflow owns them.

**One-time setup:** create the `marketplace` environment with the secret `POPCRAFT_TOKEN`: a PopCraft personal access
token with the `marketplace:publish` scope. Optionally set the repository variable `POPCRAFT_URL` to target another
deployment.

## Checks

```sh
npm install
npm run lint     # ESLint, Prettier, markdownlint
npm test         # node:test, no dependencies beyond Node
npm run pack     # build the installable bundle
node scripts/contract-check.mjs   # tools, protocol and allowlist match the extension
```
