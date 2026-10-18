import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AgentMarkdown, openExplicitLink, safeLink } from './AgentMarkdown';

function render(markdown: string, streaming = false) {
  return renderToStaticMarkup(
    createElement(AgentMarkdown, { language: 'zh', children: markdown, streaming }),
  );
}

describe('safe streaming Markdown', () => {
  it('keeps incomplete code fences readable without executing their contents', () => {
    const html = render(
      '你好，进度如下：\n\n```typescript\nconst value = "still streaming";',
      true,
    );
    expect(html).toContain('你好，进度如下：');
    expect(html).toContain('still streaming');
    expect(html).toContain('<pre');
    expect(html).not.toContain('animate-');
  });

  it('does not create remote image or raw HTML elements', () => {
    const html = render(
      '![tracking](https://tracker.example/pixel)\n\n<img src="https://tracker.example/raw"><iframe src="https://bad.example"></iframe><script>alert(1)</script>',
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('src="https://');
  });

  it('only creates explicit safe web links with no opener or referrer', () => {
    const html = render(
      '[safe](https://example.com/path) [unsafe](javascript:alert) [local](file:///etc/passwd)',
    );
    expect(html).toContain('href="https://example.com/path"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="file:');
    expect(safeLink('https://user:secret@example.com')).toBeUndefined();
    expect(safeLink('//example.com')).toBeUndefined();
    expect(safeLink('data:text/html,hello')).toBeUndefined();
  });

  it('opens desktop links synchronously from the explicit click through the bridge', async () => {
    const event = { preventDefault: vi.fn() };
    const desktop = { openExternal: vi.fn().mockResolvedValue(true) };
    const result = openExplicitLink(event, 'https://example.com/path', desktop);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(desktop.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/path');
    await expect(result).resolves.toBe(true);
  });

  it('leaves normal browser-demo link navigation alone', () => {
    const event = { preventDefault: vi.fn() };
    expect(openExplicitLink(event, 'https://example.com', undefined)).toBeUndefined();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    'javascript:alert(1)',
    'file:///tmp/private',
    'not a URL',
    '//example.com',
    'https://user:secret@example.com',
    'https://example.com/\ntracking',
    'https://example.com/' + 'a'.repeat(2048),
  ])('never passes an unsafe or invalid URL to the desktop bridge: %s', (url) => {
    const event = { preventDefault: vi.fn() };
    const desktop = { openExternal: vi.fn().mockResolvedValue(true) };
    expect(safeLink(url)).toBeUndefined();
    expect(openExplicitLink(event, url, desktop)).toBeUndefined();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(desktop.openExternal).not.toHaveBeenCalled();
  });

  it('uses the official CJK plugin for emphasis adjacent to punctuation', () => {
    const html = render('这里是**“中文重点”**之后的文字。');
    expect(html).toContain('中文重点');
    expect(html).toContain('<strong');
    expect(html).not.toContain('**');
  });

  it('retains long tokens and CJK prose rather than truncating them', () => {
    const token = 'a'.repeat(1000);
    const html = render(`中文 mixed English\n\n${token}`);
    expect(html).toContain(token);
    expect(html).toContain('中文 mixed English');
  });
});
