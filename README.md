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
- uses: danconwaydev/setup-ngit@v3
- run: ngit --version
```

Pin a specific ngit version:

```yaml
- uses: danconwaydev/setup-ngit@v3
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

## How it verifies downloads — and what that does and doesn't cover

`manifest.txt` in this repository pins the exact SHA-256 of every release
asset. The install script downloads from the mirrors listed for the asset
(tried in order) and refuses anything whose hash does not match. `latest`
resolves against the manifest shipped with the action ref you use, not
against a network lookup, so runs are reproducible per action ref.

Be clear-eyed about what this guarantees. The pinned hash ensures every
run installs byte-for-byte the asset the manifest row was recorded
against — no mirror can later swap the artifact without the install
failing loudly. From ngit 3.0.0-rc.7 onward, rows are recorded from
ngit's signed NIP-82 release asset events: the hash is the sha256 the
release author signed, downloads try the content-addressed Blossom URL
first, and the GitHub Releases URL is only a trailing fallback mirror.
Rows for earlier versions were recorded by hashing assets fetched from
GitHub Releases, so their origin rests on GitHub at pin time.

One GitHub dependency remains regardless: `uses:` fetches this action
(manifest included) from GitHub. Pinning the action by full commit SHA
makes the manifest content tamper-evident; pinning only by tag leaves the
tag movable.

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

The action's floating tags track ngit's major version: `v3` always points
at the commit whose manifest pins the newest ngit 3.x as `latest`. When a
new ngit major ships, a fresh floating tag (`v4`, ...) starts and the old
one stays frozen at the last release of its major, so `@vN` never crosses
a breaking ngit major. There is no separate action-version tag series;
for exact reproducibility pin `with: version:` or pin this action by
commit SHA.

To add a release, append `asset|...` rows for the new version to
`manifest.txt`, update the `latest|...` line, and slide the major's
floating tag.

## License

MIT
