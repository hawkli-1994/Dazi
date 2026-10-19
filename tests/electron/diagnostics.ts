import { test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Only attached to isolated test processes with credential-free environment allowlists. */
export function fixtureDiagnostics(name = 'electron-lifecycle') {
  const info = test.info();
  const lines: string[] = [];
  let length = 0;
  const limit = 2 * 1024 * 1024;
  function record(source: string, value: string): void {
    const line = `${new Date().toISOString()} [${source}] ${value.trimEnd()}\n`;
    lines.push(line);
    length += line.length;
    while (length > limit && lines.length > 1) length -= lines.shift()!.length;
  }
  return {
    record,
    application(application: ElectronApplication): void {
      const process = application.process();
      record('process', `Started PID ${process.pid ?? 'unknown'}.`);
      process.stdout?.on('data', (data: Buffer) => record('stdout', data.toString()));
      process.stderr?.on('data', (data: Buffer) => record('stderr', data.toString()));
      process.on('exit', (code, signal) => record('process-exit', `code=${code} signal=${signal}`));
      process.on('error', (error) => record('process-error', error.stack ?? error.message));
      application.on('console', (message) => record(`main-${message.type()}`, message.text()));
      application.on('close', () => record('application', 'Closed.'));
    },
    page(page: Page): void {
      page.on('console', (message) => record(`renderer-${message.type()}`, message.text()));
      page.on('pageerror', (error) => record('page-error', error.stack ?? error.message));
      page.on('crash', () => record('renderer', 'Crashed.'));
      page.on('close', () => record('renderer', 'Closed.'));
      page.on('requestfailed', (request) =>
        record('request-failed', `${request.url()} ${request.failure()?.errorText ?? ''}`),
      );
    },
    async save(): Promise<void> {
      const path = info.outputPath(`${name}.log`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, lines.join(''));
      await info.attach(name, { path, contentType: 'text/plain' });
    },
  };
}
