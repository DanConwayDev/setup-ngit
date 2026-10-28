# setup-ngit agent guide

Read `README.md` before changing the action or promoting a release. This is a
composite action for GitHub and Nostr CI; `manifest.txt` is its version and
checksum authority. `latest` means the version pinned in that manifest, not a
network lookup performed by the installer.

## Routine updates and dependencies

Treat a request to update this action as an end-to-end maintenance round:
discover the newest stable ngit release, review this repository's other
dependencies, validate and commit coherent changes, and publish `main` and the
appropriate floating major tag to both remotes. A manifest commit or a `main`
push alone does not complete a release: consumers using `@vN` only receive it
after that tag moves. Honor requests limited to preparation, review, a PR, or
deferred publication; report the remaining release steps explicitly.

When available, consult the local [dependency update runbook](work/dependency-updates.md)
for update rounds and security reports. This Git-ignored file is optional and
is not distributed with the repository. Keep its watchlist focused on active
findings and upgrade constraints; remove resolved items. If it is absent,
follow the procedure here. Keep private watchlist details out of public
documentation, commits, and PRs.

- Discover current releases from ngit's canonical Nostr repository and trusted
  signed release metadata. Select the highest final `X.Y.Z` in the current
  major, not a prerelease or merely the most recently published event. Report
  a newer major for an explicit promotion plan; do not cross majors silently.
  An explicit requested version takes precedence over automatic discovery.
- Stable means a final ngit release pinned as `latest` in `manifest.txt` and
  served through the corresponding action `vN` tag. There is no separate
  `stable` or `latest` Git tag; do not invent one during routine maintenance.
- Inventory dependencies afresh, including hidden configuration: both CI
  workflows, referenced actions, Node versions, runner images, and installer
  tool/platform requirements. Inspect any package manifests, lockfiles, or
  development environments added since the last round. Currently the sync
  script uses Node built-ins and there is no npm dependency tree to update.
- Check official upstream releases, support policies, and relevant advisories.
  Update compatible dependencies and review major migrations separately.
  Keep shared workflow steps aligned while preserving Nostr CI's Linux-only
  coverage. Preserve intentional old-version installer fixtures and historical
  manifest pins; they are compatibility tests, not stale dependencies.
- Record what was updated, checked and unchanged, or blocked. Do not claim a
  dependency/security audit from an ngit version bump alone. Keep independent
  dependency changes in separate atomic commits with appropriate validation.

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
  changes. A request for a routine update/release includes publishing `main`
  and its floating major tag; do not ask for the same authorization again.
  If publication is outside the requested scope or explicitly deferred,
  prepare the validated commits first and identify both branch and tag work
  when seeking approval to finish the release.
- Publish `main` to the authoritative Nostr repository and the GitHub action
  mirror. Verify both remote commits before advancing the appropriate floating
  major tag on both. Read each remote tag's current OID and use an explicit
  `--force-with-lease=refs/tags/vN:<observed-old-oid>` when updating it. Stop and
  inspect unexpected ref changes rather than replacing the lease blindly.
  Nostr pushes may replicate to GitHub; re-read refs before a separate mirror
  push and skip it if the desired commit is already there.
- Verify `main` and `refs/tags/vN` on both remotes against the intended release
  commit, and confirm that commit's manifest selects the intended version.
  Even if the manifest is already current, check for an unfinished tag
  promotion. Never report the update as released while `@vN` still serves the
  previous manifest. Report partial publication or signer failures explicitly
  and resume all remaining steps when the blocker is cleared.
- Never advance an older major's floating tag to a new ngit major. Versioned
  product release tags are immutable; only the action's floating major tag is
  deliberately movable.
- A push is not CI success. Check the exact commit's Nostr CI result and
  GitHub CI as well, distinguishing completed commit checks from new tag runs.
  Report pending, missing, or failed checks accurately. The sync script does
  not commit, push, move tags, or install a release-event trigger.

## Collaboration

Load the ngit skill for Nostr collaboration and CI operations. Treat the
`nostr://` remote as authoritative; GitHub is the action-distribution mirror,
not the issue or PR system. Use `pr/` branches when a PR is requested, and
honor explicit requests for direct `main` updates instead. Use `dcagent` for
routine collaboration; use `dcdev` only with explicit user authorization.
