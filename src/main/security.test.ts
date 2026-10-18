import { describe, expect, it } from 'vitest';
import { externalWebUrl } from '../shared/rpc/desktop';
import {
  allowsRendererRequest,
  AppEntry,
  isTrustedDocument,
  isTrustedSender,
  rendererCsp,
  rendererEntry,
  resolveAppAsset,
} from './security';

describe('desktop security boundary', () => {
  it('opens only bounded web links without credentials or control characters', () => {
    expect(externalWebUrl('https://example.com/review#comment')).toBe(
      'https://example.com/review#comment',
    );
    expect(externalWebUrl('http://example.com')).toBe('http://example.com/');
    for (const value of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,test',
      'https://user:secret@example.com',
      'https://user@example.com',
      'https://example.com/\nheader',
      `https://example.com/${'a'.repeat(2048)}`,
      ' https://example.com/',
      '/relative',
      null,
      {},
    ])
      expect(externalWebUrl(value)).toBeNull();
  });
  it('allows only the exact app document, including its in-app hash routes', () => {
    expect(isTrustedDocument(`${AppEntry}#/work/test`, AppEntry)).toBe(true);
    for (const candidate of [
      'https://app/index.html',
      'dazi://app.evil/index.html',
      'dazi://app/other.html',
      `${AppEntry}?redirect=elsewhere`,
      'dazi://user@app/index.html',
      'file:///index.html',
      'invalid',
    ]) {
      expect(isTrustedDocument(candidate, AppEntry)).toBe(false);
    }
  });

  it('checks both the registered webContents and its main frame', () => {
    const frame = { url: AppEntry };
    const contents = { mainFrame: frame };
    expect(isTrustedSender({ sender: contents, senderFrame: frame }, contents, AppEntry)).toBe(
      true,
    );
    expect(isTrustedSender({ sender: {}, senderFrame: frame }, contents, AppEntry)).toBe(false);
    expect(
      isTrustedSender({ sender: contents, senderFrame: { url: AppEntry } }, contents, AppEntry),
    ).toBe(false);
    expect(isTrustedSender({ sender: contents, senderFrame: null }, contents, AppEntry)).toBe(
      false,
    );
  });

  it('serves only application assets without traversal or other origins', () => {
    expect(resolveAppAsset('dazi://app/assets/main.js', '/bundle/dist')).toBe(
      '/bundle/dist/assets/main.js',
    );
    expect(resolveAppAsset('dazi://app/', '/bundle/dist')).toBe('/bundle/dist/index.html');
    for (const candidate of [
      'dazi://evil/assets/main.js',
      'file:///etc/passwd',
      'dazi://app/..%2f..%2fsecret',
      'dazi://app/%5c..%5csecret',
      'dazi://app/%00secret',
      'dazi://app/%zz',
      'dazi://user@app/index.html',
    ]) {
      expect(resolveAppAsset(candidate, '/bundle/dist')).toBeNull();
    }
  });

  it('rejects renderer network and arbitrary local-file access', () => {
    expect(allowsRendererRequest('dazi://app/assets/main.css', AppEntry)).toBe(true);
    expect(allowsRendererRequest('https://example.com', AppEntry)).toBe(false);
    expect(allowsRendererRequest('file:///etc/passwd', AppEntry)).toBe(false);
    expect(allowsRendererRequest('dazi://app.evil/index.html', AppEntry)).toBe(false);
    expect(rendererCsp(AppEntry)).toContain("connect-src 'none'");
    expect(rendererCsp(AppEntry)).toContain("script-src 'self';");
    expect(rendererCsp(AppEntry)).toContain("frame-src 'none'");
  });

  it('ignores development URL in packaged builds and restricts it to loopback', () => {
    expect(rendererEntry('https://evil.test', true)).toBe(AppEntry);
    expect(rendererEntry(undefined, false)).toBe(AppEntry);
    expect(rendererEntry('http://127.0.0.1:5173', false)).toBe('http://127.0.0.1:5173/');
    expect(rendererEntry('http://[::1]:5173/', false)).toBe('http://[::1]:5173/');
    for (const url of [
      'https://evil.test',
      'http://localhost:5173',
      'http://127.0.0.1.evil/',
      'http://127.0.0.1/app',
      'http://user@127.0.0.1/',
    ]) {
      expect(() => rendererEntry(url, false)).toThrow();
    }
    expect(allowsRendererRequest('ws://127.0.0.1:5173', 'http://127.0.0.1:5173/')).toBe(true);
    expect(allowsRendererRequest('http://127.0.0.1:5174', 'http://127.0.0.1:5173/')).toBe(false);
  });
});
