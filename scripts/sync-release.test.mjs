import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseRows, syncRelease, tagCommit, updateManifest } from "./sync-release.mjs";

const version = "3.12.4";
const commit = "a".repeat(40);
const author = "a008def15796fba9a0d6fab04e8fd57089285d9fd505da5a83fe8aad57a3564d";
const app = `32267:${author}:ngit`;
function fixture() {
  const assets = [
    ["x86_64-unknown-linux-gnu.2.17.tar.gz", ["linux-x86_64"], "glibc-2.17"],
    ["x86_64-unknown-linux-musl.tar.gz", ["linux-x86_64"], "musl"],
    ["aarch64-unknown-linux-gnu.2.17.tar.gz", ["linux-aarch64"], "glibc-2.17"],
    ["universal-apple-darwin.tar.gz", ["darwin-aarch64", "darwin-x86_64"], "universal"],
    ["x86_64-pc-windows-msvc.zip", ["windows-x86_64"], "msvc"],
  ].map(([suffix, platforms, variant], index) => {
    const hash = String(index + 1).repeat(64);
    const filename = `ngit-v${version}-${suffix}`;
    return { event_id: hash, author, application_coordinate: app, version,
      resolution: "resolved", validation: [], platforms, variant,
      mime: suffix.endsWith(".zip") ? "application/zip" : "application/gzip",
      filename, sha256: hash, size: "100", url: `https://blossom.example/${hash}`,
      original_url: `https://github.com/DanConwayDev/ngit-cli/releases/download/v${version}/${filename}`,
      verification: { ok: true, observed_sha256: hash, observed_size: "100" } };
  });
  return { format_version: 2, command: "release.view", command_status: "ok", result: {
    application: { coordinate: app, trusted: true, fully_linked_to_current_repository: true, validation: [] },
    release: { author, application_coordinate: app, version, channel: "main", commit,
      validation: [], event_id: "f".repeat(64), asset_ids: assets.map(a => a.event_id) },
    assets, unresolved_asset_ids: [],
  } };
}

test("fetch canonical tag objects and peel to a commit without advertised peeled refs", async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, args]);
    return { stdout: args.includes("rev-parse") ? commit + "\n" : "" };
  };
  assert.equal(await tagCommit(run, "/unused", version, {}), commit);
  assert.ok(calls[0][1].includes(`refs/tags/v${version}`));
  assert.ok(calls[1][1].includes("FETCH_HEAD^{commit}"));
  await assert.rejects(tagCommit(async () => ({ stdout: "" }), "/unused", version, {}));
});

test("deterministic complete platform rows, preserving old versions and repeat runs", () => {
  const document = fixture();
  const rows = releaseRows(document, version, commit);
  document.result.assets.reverse();
  assert.deepEqual(releaseRows(document, version, commit), rows);
  const before = "# old pins stay intact\nlatest|3.9.9\nasset|2.6.3|legacy\n";
  const after = updateManifest(before, version, rows);
  assert.ok(after.endsWith("asset|2.6.3|legacy\n"));
  assert.ok(after.includes(`latest|${version}\n`));
  assert.equal(updateManifest(after, version, rows), after);
  assert.throws(() => updateManifest(after, "3.9.9", rows), /downgrade/u);
  assert.throws(() => updateManifest(before, "4.0.0", rows), /major/u);
  assert.throws(() => updateManifest(before, "3.12.4-rc.1", rows));
  assert.throws(() => updateManifest(after, version, rows.map(r => r + "|changed")), /pins/u);
  assert.throws(() => updateManifest(`latest|${version}\n`, version, rows), /incomplete/u);
});

test("reject unverifiable, incomplete, mismatched and unsafe signed-release metadata", () => {
  for (const mutate of [
    d => { d.command_status = "error"; },
    d => { d.result.application.trusted = false; },
    d => { d.result.application.fully_linked_to_current_repository = false; },
    d => { d.result.release.author = "0".repeat(64); },
    d => { d.result.release.channel = "rc"; },
    d => { d.result.release.commit = "b".repeat(40); },
    d => { d.result.release.version = "3.12.5"; },
    d => { d.result.unresolved_asset_ids.push("missing"); },
    d => { d.result.assets.pop(); },
    d => { d.result.assets[1] = d.result.assets[0]; },
    d => { d.result.release.asset_ids[0] = "e".repeat(64); },
    d => { d.result.assets[0].verification = null; },
    d => { d.result.assets[0].verification.ok = false; },
    d => { d.result.assets[0].verification.observed_sha256 = "0".repeat(64); },
    d => { d.result.assets[0].verification.observed_size = "99"; },
    d => { d.result.assets[0].validation.push("invalid"); },
    d => { d.result.assets[0].filename = "../ngit.tar.gz"; },
    d => { d.result.assets[0].url = "https://blossom.example/latest"; },
    d => { d.result.assets[0].url = d.result.assets[0].url.replace("https:", "http:"); },
    d => { d.result.assets[0].url += "|evil"; },
    d => { d.result.assets[0].url = d.result.assets[0].url.replace("https://", "https://user:password@"); },
    d => { d.result.assets[0].original_url = "https://github.com/other/release"; },
    d => { d.result.assets[0].platforms = ["windows-x86_64"]; },
    d => { d.result.assets[0].variant = "musl"; },
  ]) {
    const document = fixture();
    mutate(document);
    assert.throws(() => releaseRows(document, version, commit));
  }
});

test("sync checks before writing, repeats without drift, and preserves files on failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "setup-ngit-sync-test-"));
  try {
    const manifestPath = join(directory, "manifest.txt");
    const before = "latest|3.9.9\nasset|2.6.3|legacy\n";
    await writeFile(manifestPath, before);
    const calls = [];
    const run = async (command, args) => {
      calls.push([command, args]);
      return { stdout: command === "git" ? (args.includes("rev-parse") ? commit + "\n" : "") : JSON.stringify(fixture()) };
    };
    await assert.rejects(syncRelease(version, { manifestPath, run, check: true }), /needs syncing/u);
    assert.equal(await readFile(manifestPath, "utf8"), before);
    assert.equal(await syncRelease(version, { manifestPath, run }), true);
    const after = await readFile(manifestPath, "utf8");
    assert.equal(await syncRelease(version, { manifestPath, run, check: true }), false);
    assert.equal(await readFile(manifestPath, "utf8"), after);
    assert.ok(calls.some(([command, args]) => command === "ngit" && args.includes("--verify")));
    await assert.rejects(syncRelease(version, { manifestPath, run: async () => { throw Error("network failure"); } }));
    assert.equal(await readFile(manifestPath, "utf8"), after);
    let peels = 0;
    await assert.rejects(syncRelease(version, { manifestPath, run: async (command, args) => {
      if (args.includes("rev-parse") && ++peels === 2) return { stdout: "b".repeat(40) };
      return run(command, args);
    } }), /tag changed/u);
    assert.equal(await readFile(manifestPath, "utf8"), after);
    await assert.rejects(syncRelease(version, { manifestPath, run: async (command, args) => {
      if (command === "ngit") {
        const bad = fixture();
        bad.result.assets[0].verification.ok = false;
        return { stdout: JSON.stringify(bad) };
      }
      return run(command, args);
    } }));
    assert.equal(await readFile(manifestPath, "utf8"), after);
    await assert.rejects(syncRelease(version, { manifestPath, run: async (command, args) => {
      if (command === "ngit") await writeFile(manifestPath, after + "# concurrent edit\n");
      return run(command, args);
    } }), /manifest changed/u);
    assert.equal(await readFile(manifestPath, "utf8"), after + "# concurrent edit\n");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
