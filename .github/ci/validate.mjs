import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const expectedFailures = JSON.parse(fs.readFileSync(path.join(directory, 'expected-baseline-failures.json')));
const expectedPaths = [
  'packages/hooks/src/useRequest/__tests__/useRetryPlugin.spec.ts',
  'packages/hooks/src/useRequest/src/plugins/useRetryPlugin.ts',
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gitBlob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function checkFocused(report, baseline) {
  assert.equal(report.numTotalTests, 71, 'Focused suite count changed');
  assert.equal(report.numPassedTests, baseline ? 43 : 71);
  assert.equal(report.numFailedTests, baseline ? 28 : 0);
  assert.equal(report.numPendingTests, 0);
  assert.equal(report.numTodoTests, 0);
  assert.equal(report.testResults.length, 1);
  const tests = report.testResults.flatMap((suite) => suite.assertionResults);
  assert.equal(tests.length, 71);
  const failures = tests.filter((test) => test.status === 'failed');
  assert.deepEqual(failures.map((test) => test.fullName).sort(), baseline ? expectedFailures : []);
  for (const failure of failures) {
    const text = failure.failureMessages.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
    assert.match(text, /expected.*to be called [12] times, but got [23] times/s,
      'A baseline failure has a different cause');
  }
}

function checkRuntime(report, processResult, baseline) {
  const expectedExit = baseline ? 1 : 0;
  assert.equal(processResult.exitCode, expectedExit, 'Unexpected native process exit');
  assert.equal(processResult.signal, null, 'Native process received a signal');
  assert.equal(processResult.error, undefined, 'Native process had an execution error');
  assert.equal(report.initialized, true);
  assert.equal(report.started, true);
  assert.equal(report.ended, true);
  assert.equal(report.runStartCalls, 1);
  assert.equal(report.runEndCalls, 1);
  assert.equal(report.moduleCount, 1);
  assert.equal(report.processTimedOut, false);
  assert.equal(report.processExitObserved, true, 'Missing process-exit completion evidence');
  assert.equal(report.processExitCode, expectedExit);
  assert.equal(report.status, 'completed');
  assert.equal(report.reason, baseline ? 'failed' : 'passed');
  assert.equal(report.stateReadError, null);
  assert.deepEqual(report.runEndUnhandledErrors, [], 'Unhandled errors were reported at test-run end');
  assert.deepEqual(report.exitUnhandledErrors, [], 'Unhandled errors remained at process exit');
}

function checkCoverage(report) {
  const target = Object.entries(report).filter(([name]) => name.endsWith('/src/useRequest/src/plugins/useRetryPlugin.ts'));
  assert.equal(target.length, 1, 'Expected coverage for exactly the changed production file');
  for (const metric of ['lines', 'statements', 'functions', 'branches']) {
    assert.equal(target[0][1][metric].pct, 100, `Target ${metric} coverage below 100%`);
    assert.equal(target[0][1][metric].covered, target[0][1][metric].total);
  }
}

function selfTest() {
  const makeReport = (baseline) => {
    const failures = baseline ? expectedFailures : [];
    const tests = failures.map((fullName) => ({
      fullName, status: 'failed', failureMessages: ['AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times'],
    }));
    while (tests.length < 71) tests.push({ fullName: `control-${tests.length}`, status: 'passed', failureMessages: [] });
    return { numTotalTests: 71, numPassedTests: baseline ? 43 : 71, numFailedTests: baseline ? 28 : 0,
      numPendingTests: 0, numTodoTests: 0, testResults: [{ assertionResults: tests }] };
  };
  checkFocused(makeReport(true), true);
  checkFocused(makeReport(false), false);
  const wrongCause = makeReport(true);
  wrongCause.testResults[0].assertionResults[0].failureMessages = ['Cannot resolve a dependency'];
  assert.throws(() => checkFocused(wrongCause, true));
  const wrongName = makeReport(true);
  wrongName.testResults[0].assertionResults[0].fullName = 'unrelated failure';
  assert.throws(() => checkFocused(wrongName, true));
  const skipped = makeReport(false);
  skipped.numPendingTests = 1;
  assert.throws(() => checkFocused(skipped, false));
  assert.throws(() => checkFocused(makeReport(true), false));
  const coverage = { '/tmp/src/useRequest/src/plugins/useRetryPlugin.ts': Object.fromEntries(
    ['lines', 'statements', 'functions', 'branches'].map((name) => [name, { pct: 100, total: 10, covered: 10 }]),
  ) };
  checkCoverage(coverage);
  coverage['/tmp/src/useRequest/src/plugins/useRetryPlugin.ts'].branches.pct = 90;
  assert.throws(() => checkCoverage(coverage));
  const cleanRuntime = { initialized: true, started: true, ended: true, runStartCalls: 1, runEndCalls: 1, moduleCount: 1, processTimedOut: false, processExitObserved: true, processExitCode: 1, status: 'completed', reason: 'failed', stateReadError: null, runEndUnhandledErrors: [], exitUnhandledErrors: [] };
  const redProcess = { exitCode: 1, signal: null, error: undefined };
  checkRuntime(cleanRuntime, redProcess, true);
  for (const mutation of [{ runEndUnhandledErrors: [{ message: 'unexpected rejection' }] }, { exitUnhandledErrors: [{ message: 'late rejection' }] }, { processExitObserved: false }, { ended: false }, { reason: 'interrupted' }, { processTimedOut: true }]) assert.throws(() => checkRuntime({ ...cleanRuntime, ...mutation }, redProcess, true));
  assert.throws(() => checkRuntime(cleanRuntime, { ...redProcess, exitCode: 2 }, true));
  assert.throws(() => checkRuntime(cleanRuntime, { ...redProcess, signal: 'SIGTERM' }, true));
  checkRuntime({ ...cleanRuntime, processExitCode: 0, reason: 'passed' }, { ...redProcess, exitCode: 0 }, false);
  console.log('Harness validator self-tests passed: valid reports accepted; wrong cause/name, skipped tests, unexpected failures, and incomplete coverage rejected.');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain && process.argv.includes('--self-test')) {
  selfTest();
} else if (isMain) {
  const manifest = readJson(path.join(directory, 'manifest.json'));
  const workspace = path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const baseline = path.join(workspace, 'baseline');
  const candidate = path.join(workspace, 'candidate');
  const reports = process.env.AHOOKS_REPORT_DIR;
  assert(reports && process.env.RUNNER_TEMP && path.resolve(reports).startsWith(`${path.resolve(process.env.RUNNER_TEMP)}${path.sep}`),
    'Report directory must be initialized under RUNNER_TEMP by the workflow shell step');
  fs.mkdirSync(reports, { recursive: true });
  const summary = { source: manifest, node: process.version, phases: [], comparison: {}, complete: false };
  const save = () => fs.writeFileSync(path.join(reports, 'summary.json'), JSON.stringify(summary, null, 2));
  const output = (name) => path.join(reports, name);

  function command(name, binary, args, cwd, { required = true, env = {}, timeout = 1_200_000 } = {}) {
    const log = output(`${name}.log`);
    const fd = fs.openSync(log, 'w');
    console.log(`START ${name}: ${binary} ${args.join(' ')}`);
    const entry = { name, required, binary, args, started: new Date().toISOString(),
      status: 'running', exitCode: null, log: path.basename(log) };
    summary.phases.push(entry);
    save();
    let result;
    try {
      result = spawnSync(binary, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], timeout });
    } catch (error) {
      result = { status: null, signal: null, error };
    } finally { fs.closeSync(fd); }
    Object.assign(entry, { finished: new Date().toISOString(), status: result.signal || result.error ? 'interrupted' : 'finished',
      exitCode: result.status ?? 124, signal: result.signal, error: result.error?.message });
    save();
    console.log(`END ${name}: exit=${entry.exitCode}`);
    if (entry.exitCode !== 0) console.log(fs.readFileSync(log, 'utf8').split('\n').slice(-45).join('\n'));
    return entry;
  }
  function check(name, fn) {
    try {
      const value = fn();
      summary.phases.push({ name, required: true, exitCode: 0, value });
      save();
      return true;
    } catch (error) {
      summary.phases.push({ name, required: true, exitCode: 1, error: error.stack });
      console.error(`${name}: ${error.message}`);
      save();
      return false;
    }
  }
  const pnpm = (name, args, cwd, options) => command(name, 'pnpm', args, cwd, options);
  const git = (cwd, args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const checkCandidate = () => {
    for (const file of manifest.files) {
      assert.equal(digest(fs.readFileSync(path.join(candidate, file.path))), file.sha256, file.path);
    }
    assert.equal(digest(fs.readFileSync(path.join(candidate, 'pnpm-lock.yaml'))), manifest.lockSha256);
  };
  const expectedProduction = manifest.files.find((file) => file.path.endsWith('/src/plugins/useRetryPlugin.ts'));
  const testPath = expectedPaths[0];

  const safe = check('preflight', () => {
    assert.equal(process.env.GITHUB_EVENT_NAME, 'push');
    assert.equal(process.env.GITHUB_REPOSITORY, 'dvd233/hooks');
    assert.equal(manifest.repository, 'dvd233/hooks');
    assert.equal(manifest.repositoryId, '1352925854');
    assert.equal(process.env.GITHUB_REPOSITORY_ID, manifest.repositoryId);
    assert.equal(process.env.GITHUB_REPOSITORY_OWNER_ID, '111864431');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/validation/retry-disable');
    assert.match(manifest.sourceSha, /^[0-9a-f]{40}$/);
    assert.equal(manifest.baseSha, '43003f3bd5e6921173cfa2a791ed9d34e5221935');
    assert.deepEqual(manifest.files.map((file) => file.path).sort(), expectedPaths);
    assert.equal(git(baseline, ['rev-parse', 'HEAD']), manifest.baseSha);
    assert.equal(git(candidate, ['rev-parse', 'HEAD']), manifest.sourceSha);
    assert.equal(git(candidate, ['rev-parse', 'HEAD^{tree}']), manifest.sourceTree);
    assert.equal(git(candidate, ['rev-parse', 'HEAD^']), manifest.baseSha);
    assert.deepEqual(git(candidate, ['diff', '--name-only', manifest.baseSha, manifest.sourceSha]).split('\n').sort(), expectedPaths);
    for (const file of manifest.files) assert.equal(gitBlob(fs.readFileSync(path.join(baseline, file.path))), file.baseBlobSha);
    assert.equal(digest(fs.readFileSync(path.join(baseline, 'pnpm-lock.yaml'))), manifest.lockSha256);
    checkCandidate();
    const version = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0);
    assert.equal(version.stdout.trim(), '10.12.4');
    return { repository: manifest.repository, sourceSha: manifest.sourceSha, baseSha: manifest.baseSha, pnpm: version.stdout.trim() };
  });

  if (safe) {
    const native = (label, checkout) => {
      const installed = pnpm(`${label}-install`, ['install', '--frozen-lockfile'], checkout).exitCode === 0;
      if (!installed) {
        summary.phases.push({ name: `${label}-native-stages`, required: true, exitCode: 1, blocked: 'Full workspace install failed; dependent stages not run.' });
        save();
        return false;
      }
      check(`${label}-locked-runtime`, () => {
        const expected = { react: '19.1.1', 'react-dom': '19.1.1', '@testing-library/react': '16.3.0',
          vitest: '4.1.2', jsdom: '29.0.2', '@vitest/coverage-istanbul': '3.2.4' };
        for (const [name, version] of Object.entries(expected)) {
          assert.equal(readJson(path.join(checkout, 'node_modules', name, 'package.json')).version, version, name);
        }
        return expected;
      });
      pnpm(`${label}-build`, ['run', 'build'], checkout);
      pnpm(`${label}-types`, ['run', 'tsc'], checkout);
      pnpm(`${label}-workspace-tests`, ['run', 'test'], checkout);
      pnpm(`${label}-workspace-strict`, ['run', 'test:strict'], checkout);
      return true;
    };
    const baselineInstalled = native('baseline', baseline);
    if (baselineInstalled) {
      fs.copyFileSync(path.join(candidate, testPath), path.join(baseline, testPath));
      check('baseline-production-still-original', () => {
        assert.equal(gitBlob(fs.readFileSync(path.join(baseline, expectedProduction.path))), expectedProduction.baseBlobSha);
        assert.equal(digest(fs.readFileSync(path.join(baseline, testPath))), manifest.files.find((file) => file.path === testPath).sha256);
      });
      const redJson = output('baseline-focused.json');
      const redRuntime = output('baseline-focused-runtime.json');
      fs.rmSync(redJson, { force: true });
      fs.rmSync(redRuntime, { force: true });
      const red = pnpm('baseline-focused-run', ['exec', 'vitest', 'run', 'src/useRequest/__tests__/useRetryPlugin.spec.ts',
        '--no-file-parallelism', '--maxWorkers=1', '--reporter=json', `--reporter=${path.join(directory, 'runtime-reporter.mjs')}`, `--outputFile=${redJson}`],
      path.join(baseline, 'packages/hooks'), { required: false, env: { AHOOKS_RUNTIME_REPORT: redRuntime } });
      check('baseline-focused-oracle', () => {
        checkRuntime(readJson(redRuntime), red, true);
        checkFocused(readJson(redJson), true);
        return { expectedFailures: 28, passingControls: 43 };
      });
    }
    const candidateInstalled = native('candidate', candidate);
    if (candidateInstalled) {
      const hooks = path.join(candidate, 'packages/hooks');
      const focusJson = output('candidate-focused.json');
      const focusRuntime = output('candidate-focused-runtime.json');
      fs.rmSync(focusJson, { force: true });
      fs.rmSync(focusRuntime, { force: true });
      const green = pnpm('candidate-focused-run', ['exec', 'vitest', 'run', 'src/useRequest/__tests__/useRetryPlugin.spec.ts',
        '--no-file-parallelism', '--maxWorkers=1', '--reporter=json', `--reporter=${path.join(directory, 'runtime-reporter.mjs')}`, `--outputFile=${focusJson}`], hooks, { env: { AHOOKS_RUNTIME_REPORT: focusRuntime } });
      check('candidate-focused-oracle', () => {
        checkRuntime(readJson(focusRuntime), green, false);
        checkFocused(readJson(focusJson), false);
      });
      pnpm('candidate-scoped-biome', ['exec', 'biome', 'check', ...expectedPaths], candidate);
      const lockedDir = output('coverage-locked');
      pnpm('candidate-locked-coverage', ['exec', 'vitest', 'run', 'src/useRequest/__tests__/useRetryPlugin.spec.ts',
        '--no-file-parallelism', '--maxWorkers=1', '--coverage.enabled', '--coverage.provider=istanbul',
        '--coverage.include=src/useRequest/src/plugins/useRetryPlugin.ts', '--coverage.reporter=text',
        '--coverage.reporter=json-summary', `--coverage.reportsDirectory=${lockedDir}`], hooks);
      check('locked-target-coverage', () => checkCoverage(readJson(path.join(lockedDir, 'coverage-summary.json'))));
      summary.originalCoverageWarning = fs.readFileSync(output('candidate-locked-coverage.log'), 'utf8')
        .includes('Running mixed versions is not supported');
      save();

      const extra = path.join(directory, 'coverage-tools');
      const installed = pnpm('supplement-provider-install', ['install', '--frozen-lockfile', '--ignore-scripts'], extra).exitCode === 0;
      if (installed) {
        const target = path.join(extra, 'node_modules/vitest');
        if (!fs.existsSync(target)) fs.symlinkSync(path.join(candidate, 'node_modules/vitest'), target, 'dir');
        check('supplement-provider-versions', () => {
          assert.equal(readJson(path.join(extra, 'node_modules/@vitest/coverage-istanbul/package.json')).version, '4.1.2');
          assert.equal(readJson(path.join(target, 'package.json')).version, '4.1.2');
          return { provider: '4.1.2', runner: '4.1.2', separateFromOriginalLock: true };
        });
        const supplementalDir = output('coverage-compatible');
        pnpm('candidate-compatible-coverage', ['exec', 'vitest', 'run', 'src/useRequest/__tests__/useRetryPlugin.spec.ts',
          '--no-file-parallelism', '--maxWorkers=1', '--coverage.enabled', '--coverage.provider=custom',
          `--coverage.customProviderModule=${path.join(extra, 'node_modules/@vitest/coverage-istanbul/dist/index.js')}`,
          '--coverage.include=src/useRequest/src/plugins/useRetryPlugin.ts', '--coverage.reporter=text',
          '--coverage.reporter=json-summary', `--coverage.reportsDirectory=${supplementalDir}`], hooks);
        check('compatible-target-coverage', () => checkCoverage(readJson(path.join(supplementalDir, 'coverage-summary.json'))));
      }
      check('final-source-integrity', () => {
        checkCandidate();
        assert.equal(git(candidate, ['diff', '--name-only', 'HEAD']), '', 'Native commands changed tracked candidate files');
        assert.equal(digest(fs.readFileSync(path.join(baseline, 'pnpm-lock.yaml'))), manifest.lockSha256);
      });
    }
    for (const stage of ['install', 'build', 'types', 'workspace-tests', 'workspace-strict']) {
      const a = summary.phases.find((phase) => phase.name === `baseline-${stage}`);
      const b = summary.phases.find((phase) => phase.name === `candidate-${stage}`);
      summary.comparison[stage] = { baselineExit: a?.exitCode ?? null, candidateExit: b?.exitCode ?? null,
        interpretation: a?.exitCode === 0 && b?.exitCode === 0 ? 'Both passed' :
          a?.exitCode !== 0 && b?.exitCode !== 0 ? 'Failed or blocked on both; inspect original logs. Not excused as a green candidate.' :
            'Different outcomes or incomplete comparison; inspect original logs' };
    }
    const normalizeTypes = (file, root) => fs.readFileSync(file, 'utf8').replaceAll(root, '<checkout>')
      .replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((line) => /error TS\d+/.test(line)).sort();
    if (fs.existsSync(output('baseline-types.log')) && fs.existsSync(output('candidate-types.log'))) {
      summary.typeDiagnostics = { baseline: normalizeTypes(output('baseline-types.log'), baseline),
        candidate: normalizeTypes(output('candidate-types.log'), candidate) };
      summary.typeDiagnostics.identical = JSON.stringify(summary.typeDiagnostics.baseline) === JSON.stringify(summary.typeDiagnostics.candidate);
    }
  }
  summary.complete = true;
  summary.passed = summary.phases.every((phase) => !phase.required || phase.exitCode === 0);
  save();
  console.log(JSON.stringify({ passed: summary.passed, comparison: summary.comparison,
    failedRequired: summary.phases.filter((phase) => phase.required && phase.exitCode !== 0).map((phase) => phase.name) }, null, 2));
  process.exitCode = summary.passed ? 0 : 1;
}

export { checkFocused, checkRuntime, checkCoverage };
