import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, lstat, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

export const REPOSITORY = "nostr://npub15qydau2hjma6ngxkl2cyar74wzyjshvl65za5k5rl69264ar2exs5cyejr/relay.ngit.dev/ngit";
const AUTHOR = "a008def15796fba9a0d6fab04e8fd57089285d9fd505da5a83fe8aad57a3564d";
const APP = `32267:${AUTHOR}:ngit`;
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const HEX = /^[0-9a-f]{64}$/u;
const TARGETS = [
  ["linux-x86_64-gnu", "x86_64-unknown-linux-gnu.2.17.tar.gz", ["linux-x86_64"], "glibc-2.17"],
  ["linux-x86_64-musl", "x86_64-unknown-linux-musl.tar.gz", ["linux-x86_64"], "musl"],
  ["linux-aarch64-gnu", "aarch64-unknown-linux-gnu.2.17.tar.gz", ["linux-aarch64"], "glibc-2.17"],
  ["darwin-universal", "universal-apple-darwin.tar.gz", ["darwin-aarch64", "darwin-x86_64"], "universal"],
  ["windows-x86_64", "x86_64-pc-windows-msvc.zip", ["windows-x86_64"], "msvc"],
];

export function stableVersion(version) {
  assert.equal(typeof version, "string", "version is required");
  assert.match(version, STABLE, "a final X.Y.Z version is required");
  return version;
}

export async function tagCommit(run, directory, version, options) {
  // Nostr remotes need not advertise peeled refs. Fetch the tag object and
  // let Git peel it rather than mistaking an annotated tag OID for a commit.
  await run("git", ["-C", directory, "fetch", "--no-tags", REPOSITORY, `refs/tags/v${version}`], options);
  const { stdout } = await run("git", ["-C", directory, "rev-parse", "FETCH_HEAD^{commit}"], options);
  const commit = stdout.trim();
  assert.match(commit, /^[0-9a-f]{40}$/u, "release tag must resolve to a commit");
  return commit;
}

function https(value) {
  assert.equal(typeof value, "string");
  assert.ok(!/[\s|]/u.test(value), "unsafe manifest URL");
  const url = new URL(value);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash,
    "asset requires a credential-free HTTPS URL");
  return url;
}

export function releaseRows(document, version, commit) {
  stableVersion(version);
  assert.equal(document.format_version, 2);
  assert.equal(document.command, "release.view");
  assert.equal(document.command_status, "ok");
  const { application, release, assets, unresolved_asset_ids: unresolved } = document.result;
  assert.equal(application.coordinate, APP);
  assert.equal(application.trusted, true);
  assert.equal(application.fully_linked_to_current_repository, true);
  assert.deepEqual(application.validation, []);
  assert.equal(release.author, AUTHOR);
  assert.equal(release.application_coordinate, APP);
  assert.equal(release.version, version);
  assert.equal(release.channel, "main");
  assert.equal(release.commit, commit, "release must match the canonical tag");
  assert.deepEqual(release.validation, []);
  assert.match(release.event_id, HEX);
  assert.deepEqual(unresolved, []);
  assert.equal(assets.length, TARGETS.length);
  assert.equal(release.asset_ids.length, TARGETS.length);
  assert.equal(new Set(release.asset_ids).size, TARGETS.length);
  assert.deepEqual(new Set(assets.map(a => a.event_id)), new Set(release.asset_ids));
  return TARGETS.map(([target, suffix, platforms, variant]) => {
    const filename = `ngit-v${version}-${suffix}`;
    const matches = assets.filter(a => a.filename === filename);
    assert.equal(matches.length, 1, `expected exactly one ${target} asset`);
    const asset = matches[0];
    assert.match(asset.event_id, HEX);
    assert.equal(asset.author, AUTHOR);
    assert.equal(asset.application_coordinate, APP);
    assert.equal(asset.version, version);
    assert.equal(asset.resolution, "resolved");
    assert.deepEqual(asset.validation, []);
    assert.deepEqual([...asset.platforms].sort(), platforms);
    assert.equal(asset.variant, variant);
    assert.equal(asset.mime, suffix.endsWith(".zip") ? "application/zip" : "application/gzip");
    assert.match(asset.sha256, HEX);
    assert.equal(asset.verification?.ok, true, "asset body was not verified");
    assert.equal(asset.verification.observed_sha256, asset.sha256);
    assert.equal(String(asset.verification.observed_size), String(asset.size));
    const url = https(asset.url);
    const extension = suffix.endsWith(".zip") ? ".zip" : ".gz";
    assert.ok([asset.sha256, asset.sha256 + extension].includes(url.pathname.split("/").at(-1)),
      "asset URL must be content-addressed");
    assert.equal(asset.original_url,
      `https://github.com/DanConwayDev/ngit-cli/releases/download/v${version}/${filename}`);
    return ["asset", version, target, filename, asset.sha256, asset.url, asset.original_url].join("|");
  });
}

export function updateManifest(manifest, version, rows) {
  stableVersion(version);
  const lines = manifest.trimEnd().split("\n");
  const latest = lines.filter(line => line.startsWith("latest|"));
  assert.equal(latest.length, 1, "manifest needs one latest entry");
  const current = stableVersion(latest[0].slice(7));
  const old = current.split(".").map(BigInt);
  const next = version.split(".").map(BigInt);
  assert.equal(next[0], old[0], "major promotion requires explicit maintainer review");
  assert.ok(next[1] > old[1] || (next[1] === old[1] && next[2] >= old[2]), "refusing downgrade");
  const existing = lines.filter(line => line.startsWith(`asset|${version}|`));
  if (existing.length) {
    assert.deepEqual([...existing].sort(), [...rows].sort(), "refusing to change existing release pins");
  }
  if (version === current) {
    assert.equal(existing.length, rows.length, "latest release inventory is incomplete");
    return manifest;
  }
  return lines.map(line => line === latest[0]
    ? [`latest|${version}`, ...(existing.length ? [] : rows)].join("\n") : line).join("\n") + "\n";
}

export async function syncRelease(version, { check = false, run = promisify(execFile),
  manifestPath = resolve(import.meta.dirname, "../manifest.txt") } = {}) {
  stableVersion(version);
  assert.ok((await lstat(manifestPath)).isFile(), "manifest must be a regular file");
  const before = await readFile(manifestPath, "utf8");
  const options = { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 600_000 };
  const directory = await mkdtemp(resolve(tmpdir(), "setup-ngit-release-"));
  try {
    await run("git", ["init", directory], options);
    const commit = await tagCommit(run, directory, version, options);
    const { stdout } = await run("ngit", ["--repo", REPOSITORY, "--defaults", "release", "view",
      version, "--verify", "--json"], options);
    const rows = releaseRows(JSON.parse(stdout), version, commit);
    assert.equal(await tagCommit(run, directory, version, options), commit,
      "release tag changed during verification");
    const after = updateManifest(before, version, rows);
    assert.equal(await readFile(manifestPath, "utf8"), before, "manifest changed during verification");
    if (check) assert.equal(after, before, "manifest needs syncing");
    else if (after !== before) {
      const temporary = `${manifestPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, after, { flag: "wx" });
        await rename(temporary, manifestPath);
      } finally { await rm(temporary, { force: true }); }
    }
    return after !== before;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [version, ...flags] = process.argv.slice(2);
    assert.ok(flags.length <= 1 && flags.every(flag => flag === "--check"),
      "usage: node scripts/sync-release.mjs X.Y.Z [--check]");
    const changed = await syncRelease(version, { check: flags.includes("--check") });
    console.log(changed ? `Pinned ngit ${version}.` : `ngit ${version} pins verified; no changes.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
