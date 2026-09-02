# setup-ngit

A composite GitHub Action that installs [ngit](https://ngit.dev) and
`git-remote-nostr` on the job's `PATH` from a pinned, checksum-verified
release manifest.

It works on GitHub-hosted runners (Linux, macOS, Windows) and in
[act](https://github.com/nektos/act)-based runners such as
[ngit-ci](https://gitworkshop.dev/danconwaydev.com/ngit-ci), so the same
workflow file can run on a GitHub mirror and on Nostr-native CI unchanged.

## Usage

```yaml
- uses: danconwaydev/setup-ngit@v1
- run: ngit --version
```

Pin a specific ngit version:

```yaml
- uses: danconwaydev/setup-ngit@v1
  with:
    version: 2.6.3
```

### Inputs

| Input     | Default  | Description                                          |
| --------- | -------- | ---------------------------------------------------- |
| `version` | `latest` | ngit version to install, or `latest` for the newest  |
|           |          | version pinned in this action's `manifest.txt`.      |

### Outputs

| Output    | Description                        |
| --------- | ---------------------------------- |
| `version` | The ngit version that was installed. |

## How it verifies downloads

`manifest.txt` in this repository pins the exact SHA-256 of every release
asset. The install script downloads from the mirrors listed for the asset
(tried in order) and refuses anything whose hash does not match, so no
mirror — including GitHub — is in the trust path. Pin this action by tag or
commit SHA and the whole chain is pinned.

`latest` resolves against the manifest shipped with the action ref you pin,
not against a network lookup, so runs are reproducible per action ref.

## Supported platforms

| Runner                    | Asset                       |
| ------------------------- | --------------------------- |
| Linux x86_64 (glibc 2.17+) | `linux-x86_64-gnu`         |
| Linux x86_64 (musl/Alpine) | `linux-x86_64-musl`        |
| Linux aarch64 (glibc 2.17+) | `linux-aarch64-gnu`       |
| macOS (Intel and Apple Silicon) | `darwin-universal`    |
| Windows x86_64            | `windows-x86_64`            |

musl vs glibc is auto-detected on Linux; set `NGIT_SETUP_TARGET` in the
step's `env` to override (e.g. `linux-x86_64-musl` on unusual distros).

## Development

The canonical repository lives on Nostr; the GitHub repository is a mirror
that exists so `uses:` resolution works. Contribute via ngit with a
`pr/`-prefixed branch.

To add a release, append `asset|...` rows for the new version to
`manifest.txt`, update the `latest|...` line, and tag. The floating `v1`
tag follows the newest `v1.x.y`.

## License

MIT
