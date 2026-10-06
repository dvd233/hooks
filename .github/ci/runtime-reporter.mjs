import fs from 'node:fs';
import path from 'node:path';

// Read-only reporter using the installed Vitest 4.1.2 Reporter API.
// It writes validation evidence outside the checked-out source and never changes Vitest state.
export default class RuntimeEvidenceReporter {
  onInit(vitest) {
    this.vitest = vitest;
    this.file = process.env.AHOOKS_RUNTIME_REPORT;
    if (!this.file || !path.isAbsolute(this.file)) throw new Error('AHOOKS_RUNTIME_REPORT must be an absolute evidence path');
    this.evidence = { schema: 1, initialized: true, started: false, ended: false,
      runStartCalls: 0, runEndCalls: 0, processTimedOut: false, processExitObserved: false,
      runEndUnhandledErrors: null, exitUnhandledErrors: null, stateReadError: null, status: 'initialized' };
    this.write();
    process.once('exit', (code) => {
      this.evidence.processExitObserved = true;
      this.evidence.processExitCode = code;
      try {
        this.evidence.exitUnhandledErrors = this.serializeErrors(this.vitest.state.getUnhandledErrors());
      } catch (error) {
        this.evidence.stateReadError = String(error?.message || error);
      }
      this.evidence.status = this.evidence.processTimedOut ? 'timed-out' : this.evidence.ended ? 'completed' : 'incomplete';
      this.write();
    });
  }
  serializeErrors(errors) {
    return errors.map((error) => ({ name: String(error?.name || error?.type || 'Error'),
      message: String(error?.message || error), stack: typeof error?.stack === 'string' ? error.stack : undefined }));
  }
  write() {
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.evidence, null, 2));
    fs.renameSync(temp, this.file);
  }
  onTestRunStart(specifications) {
    this.evidence.started = true;
    this.evidence.runStartCalls += 1;
    this.evidence.specificationCount = specifications.length;
    this.evidence.status = 'running';
    this.write();
  }
  onTestRunEnd(testModules, unhandledErrors, reason) {
    this.evidence.ended = true;
    this.evidence.runEndCalls += 1;
    this.evidence.moduleCount = testModules.length;
    this.evidence.reason = reason;
    this.evidence.runEndUnhandledErrors = this.serializeErrors(unhandledErrors);
    this.evidence.status = 'test-run-ended';
    this.write();
  }
  onProcessTimeout() {
    this.evidence.processTimedOut = true;
    this.evidence.status = 'timed-out';
    this.write();
  }
}
