import { describe, expect, it } from 'vitest';
import { HostErrorCode } from '../../host/errors';
import { runtimeErrorText } from './errors';

describe('safe localized runtime errors', () => {
  it.each(Object.values(HostErrorCode))('provides both languages for host error %s', (code) => {
    const zh = runtimeErrorText('zh', code);
    const en = runtimeErrorText('en', new Error(code));
    expect(zh).toMatch(/[\u3400-\u9fff]/);
    expect(en).toMatch(/[a-z]/i);
    expect(zh).not.toContain(code);
    expect(en).not.toContain(code);
    expect(zh).not.toBe(en);
    if (code !== HostErrorCode.OperationFailed) {
      expect(zh).not.toBe(runtimeErrorText('zh', 'UNKNOWN_ERROR'));
      expect(en).not.toBe(runtimeErrorText('en', 'UNKNOWN_ERROR'));
    }
  });

  it.each([
    'Connection lost before confirmation. Retry with the same request ID.',
    'Confirmation timed out. The work may still be running.',
  ])('retains uncertain-submission and unchanged-message retry semantics for %s', (error) => {
    expect(runtimeErrorText('zh', error)).toContain('可能已开始');
    expect(runtimeErrorText('zh', error)).toContain('保留原文');
    expect(runtimeErrorText('en', error)).toContain('may already have started');
    expect(runtimeErrorText('en', error)).toContain('exactly the same text');
  });

  it('gives connection and stopped-run actions without raw transport terminology', () => {
    expect(runtimeErrorText('zh', 'The desktop host could not restart.')).toContain('重启应用');
    expect(runtimeErrorText('en', 'The run stopped: aborted')).toContain('next step');
    expect(runtimeErrorText('zh', 'The run stopped: no_model')).toContain('能力页');
  });

  it.each([
    new Error('Provider error: Authorization=Bearer private-token /home/private/file'),
    'INVALID_INPUT private-token',
    'The run stopped: private-token',
    { message: 'private-token' },
    '__proto__',
    null,
    undefined,
  ])('never reflects unrecognized exception data', (error) => {
    for (const language of ['zh', 'en'] as const) {
      const rendered = runtimeErrorText(language, error);
      expect(rendered).toBe(runtimeErrorText(language, 'UNKNOWN_ERROR'));
      expect(rendered).not.toContain('private-token');
      expect(rendered).not.toContain('/home/');
      expect(rendered).not.toContain('Authorization');
    }
  });
});
