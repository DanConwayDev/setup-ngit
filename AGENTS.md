# setup-ngit agent guide

Read `README.md` before changing the action or promoting a release. This is a
composite action for GitHub and Nostr CI; `manifest.txt` is its version and
checksum authority. `latest` means the version pinned in that manifest, not a
network lookup performed by the installer.

## Sync a released ngit version

Use the sync command instead of hand-editing release rows. With Node.js 22+,
Git, and ngit v3 installed, substitute the requested final version:

```sh
node scripts/sync-release.mjs X.Y.Z
node --test scripts/*.test.mjs
node scripts/sync-release.mjs X.Y.Z --check
git diff --check
git diff -- manifest.txt
```

The command fetches and peels the canonical Nostr tag, verifies the trusted
signed NIP-82 release and all five archive bodies, and updates the manifest.
Repeating the same release must produce no diff. `--check` is read-only and
fails if the manifest needs syncing.

Do not bypass failed verification, overwrite existing release pins, substitute
unverified GitHub downloads, or move a product release tag. Missing assets and
source/release mismatches are blockers to investigate, not reasons to weaken
checks. Downgrades and major-version crossings are refused; a new major needs
an explicitly reviewed promotion plan.

## Validate and publish

- Run the offline tests above for sync changes. If workflows change, lint both
  `.ngit/act/workflows/test.yml` and `.github/workflows/test.yml` with actionlint.
- For a manifest promotion, smoke-test `scripts/install.sh` using a temporary
  `RUNNER_TOOL_CACHE`; do not overwrite the user's installed ngit. State which
  platforms were executed versus only hash-verified.
- Inspect status and diff, preserve unrelated work, and commit only intended
  changes. Ask permission before pushing or moving a floating tag.
- After approval, publish `main` to the authoritative Nostr repository and the
  GitHub action mirror. Verify both remote commits before advancing the
  appropriate floating major tag on both. Use an explicit expected old OID
  when force-updating that tag, and verify the resulting remote refs.
- Never advance an older major's floating tag to a new ngit major. Versioned
  product release tags are immutable; only the action's floating major tag is
  deliberately movable.
- A push is not CI success. Check the exact commit's Nostr CI result and report
  pending or failed checks accurately. The sync script itself does not commit,
  push, move tags, or install a release-event trigger.

## Collaboration

Load the ngit skill for Nostr collaboration and CI operations. Treat the
`nostr://` remote as authoritative; GitHub is the action-distribution mirror,
not the issue or PR system. Use `pr/` branches when a PR is requested, and
honor explicit requests for direct `main` updates instead. Use `dcagent` for
routine collaboration; use `dcdev` only with explicit user authorization.
