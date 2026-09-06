#!/usr/bin/env node
/**
 * Publishes the static update manifest that drives the in-app update banner.
 *
 * Echo Spend is serverless: the app answers "is there a newer build?" by
 * fetching version.json from a public repo (see services/updateChecker and
 * docs/updates.md). That file has to be bumped by hand after every release,
 * which is exactly the kind of step that gets forgotten or — worse — done from
 * the wrong numbers. This script removes both failure modes:
 *
 *   - versionCode/versionName are read from android/app/build.gradle, the file
 *     that actually ships. They are never typed in, and never taken from
 *     app.config.ts, which has drifted from the gradle values before.
 *   - It refuses to publish a versionCode at or below the one already live,
 *     so a stale checkout cannot roll the manifest backwards.
 *
 * TIMING MATTERS: run this only once a Play rollout has reached 100%. The
 * manifest is a broadcast to every install and cannot know whether a given user
 * is in a staged-rollout bucket, so publishing at 10% tells 90% of users to
 * update to a build they cannot get yet. The script asks before pushing.
 *
 * Usage:
 *   node scripts/publish-update-manifest.js --notes "Bill reminders" --notes "Faster SmartScan"
 *   node scripts/publish-update-manifest.js --dry-run
 *   node scripts/publish-update-manifest.js --min-supported 19 --yes
 *
 * Flags:
 *   --notes <text>        Release note bullet. Repeatable, max 6 shown in-app.
 *                         Omit entirely to keep the notes already published.
 *   --min-supported <n>   Force-update gate: builds below <n> get an
 *                         undismissible banner. Leave alone unless retiring a
 *                         genuinely harmful build.
 *   --dry-run             Show the resulting manifest and stop. No push.
 *   --yes                 Skip the rollout confirmation prompt (for CI).
 *   --repo <url>          Override the releases repo.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle');
const DEFAULT_REPO = 'git@github.com:Dineshkumargits/echo-spend-releases.git';
const MANIFEST = 'version.json';
const PLATFORM = 'android';

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

// ─── Args ────────────────────────────────────────────────────────────────────

const parseArgs = (argv) => {
  const out = { notes: [], dryRun: false, yes: false, repo: DEFAULT_REPO, minSupported: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--notes') {
      const v = argv[++i];
      if (!v) die('--notes needs a value');
      out.notes.push(v);
    } else if (a === '--min-supported') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 0) die('--min-supported needs a non-negative integer');
      out.minSupported = v;
    } else if (a === '--repo') {
      const v = argv[++i];
      if (!v) die('--repo needs a value');
      out.repo = v;
    } else die(`Unknown argument: ${a}`);
  }
  if (out.notes.length > 6) {
    console.warn(`! ${out.notes.length} notes given; the banner shows the first 6.`);
  }
  return out;
};

// ─── Version, straight from the file that ships ──────────────────────────────

const readShippingVersion = () => {
  if (!fs.existsSync(GRADLE)) die(`Not found: ${GRADLE}`);
  const gradle = fs.readFileSync(GRADLE, 'utf8');

  // defaultConfig assigns these once; both `versionCode = 19` and
  // `versionCode 19` are valid Gradle, hence the optional '='.
  const codeMatch = gradle.match(/versionCode\s*=?\s*(\d+)/);
  const nameMatch = gradle.match(/versionName\s*=?\s*["']([^"']+)["']/);
  if (!codeMatch) die('Could not find versionCode in android/app/build.gradle');
  if (!nameMatch) die('Could not find versionName in android/app/build.gradle');

  return { versionCode: Number(codeMatch[1]), versionName: nameMatch[1] };
};

// ─── Git helpers ─────────────────────────────────────────────────────────────

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const confirm = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const { versionCode, versionName } = readShippingVersion();

  console.log(`\nEcho Spend update manifest`);
  console.log(`  build.gradle → ${versionName} (${versionCode})`);

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-spend-manifest-'));
  let pushed = false;

  try {
    console.log(`  cloning ${args.repo}`);
    try {
      execFileSync('git', ['clone', '--depth', '1', args.repo, workdir], { stdio: 'pipe' });
    } catch (e) {
      die(`Clone failed. Check SSH access to the releases repo.\n${e.stderr || e.message}`);
    }

    const manifestPath = path.join(workdir, MANIFEST);
    let manifest = {};
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (e) {
        die(`Published ${MANIFEST} is not valid JSON — fix it by hand first.\n${e.message}`);
      }
    }

    const current = manifest[PLATFORM] || {};
    const liveCode = Number(current.latestVersionCode) || 0;
    console.log(`  published    → ${current.latestVersionName || '—'} (${liveCode || '—'})`);

    // A stale checkout is the realistic way this goes wrong: you pull an old
    // branch, run the script, and quietly roll the manifest backwards. Equal is
    // rejected too — republishing the same version is a no-op at best.
    if (liveCode >= versionCode) {
      die(
        `build.gradle is at versionCode ${versionCode}, but ${liveCode} is already published.\n` +
        `  Bump versionCode in android/app/build.gradle first, or check out the release commit.`,
      );
    }

    const next = {
      latestVersionCode: versionCode,
      latestVersionName: versionName,
      minSupportedVersionCode:
        args.minSupported !== null ? args.minSupported : Number(current.minSupportedVersionCode) || 0,
      releaseNotes: args.notes.length ? args.notes : Array.isArray(current.releaseNotes) ? current.releaseNotes : [],
      url:
        current.url || 'https://play.google.com/store/apps/details?id=com.adkdinesh.echospend',
    };

    if (!args.notes.length && next.releaseNotes.length) {
      console.warn(`\n! No --notes given; keeping the notes from the previous release.`);
    }
    if (next.minSupportedVersionCode > 0) {
      console.warn(
        `\n! minSupportedVersionCode is ${next.minSupportedVersionCode} — builds below it get an ` +
        `UNDISMISSIBLE banner.`,
      );
    }

    manifest[PLATFORM] = next;
    const serialized = JSON.stringify(manifest, null, 2) + '\n';

    console.log(`\n${serialized}`);

    if (args.dryRun) {
      console.log('--dry-run: nothing pushed.\n');
      return;
    }

    if (!args.yes) {
      const ok = await confirm(
        'Has the Play rollout for this build reached 100%? Publishing early tells\n' +
        'users to update to something they cannot install yet. [y/N] ',
      );
      if (!ok) {
        console.log('\nAborted. Nothing pushed.\n');
        return;
      }
    }

    fs.writeFileSync(manifestPath, serialized);

    if (!git(workdir, ['status', '--porcelain'])) {
      console.log('Manifest already matches what is published. Nothing to do.\n');
      return;
    }

    git(workdir, ['add', MANIFEST]);
    git(workdir, ['commit', '-m', `Release ${versionName} (${versionCode})`]);
    git(workdir, ['push']);
    pushed = true;

    const rawUrl = args.repo
      .replace(/^git@github\.com:/, 'https://raw.githubusercontent.com/')
      .replace(/^https:\/\/github\.com\//, 'https://raw.githubusercontent.com/')
      .replace(/\.git$/, '') + `/main/${MANIFEST}`;

    console.log(`\n✓ Published ${versionName} (${versionCode})`);
    console.log(`  ${rawUrl}`);
    console.log(`  raw.githubusercontent caches for ~5 minutes.\n`);
  } finally {
    // Keep the clone around on failure so a half-done push can be inspected.
    if (pushed || !fs.existsSync(path.join(workdir, '.git'))) {
      fs.rmSync(workdir, { recursive: true, force: true });
    } else if (!args.dryRun) {
      console.log(`  (clone left at ${workdir})`);
    } else {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }
})();
