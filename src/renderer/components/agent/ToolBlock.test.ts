import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { ToolResult } from './ToolBlock';

function render(content: ToolResultMessage['content']) {
  const result: ToolResultMessage = {
    role: 'toolResult',
    toolCallId: 'read-output',
    toolName: 'read_file',
    content,
    timestamp: 100,
    isError: false,
  };
  return renderToStaticMarkup(createElement(ToolResult, { result, language: 'zh' }));
}

describe('literal tool results', () => {
  it('preserves output lines, blank lines, leading whitespace, tabs and trailing spaces', () => {
    const output = '\n  first line\n\tsecond  line  \n\n第三行\n';
    expect(render([{ type: 'text', text: output }])).toContain(
      `<pre class="agent-code" tabindex="0"><code>${output}</code></pre>`,
    );
  });

  it('does not reinterpret Markdown or HTML-looking output', () => {
    const output = '# heading\n**literal**\n[link](https://example.com)\n<script>run()</script>';
    const html = render([{ type: 'text', text: output }]);
    expect(html).toContain(
      '<code># heading\n**literal**\n[link](https://example.com)\n&lt;script&gt;run()&lt;/script&gt;</code>',
    );
    expect(html).not.toMatch(/<(?:h1|strong|a|script)[\s>]/);
  });

  it('keeps ordered text and native image blocks without merging their output', () => {
    const html = render([
      { type: 'text', text: 'first\nsecond\nthird' },
      { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
      { type: 'text', text: '  last\n\tline' },
    ]);
    const first = html.indexOf('<code>first\nsecond\nthird</code>');
    const image = html.indexOf('<img class="agent-local-image"');
    const last = html.indexOf('<code>  last\n\tline</code>');
    expect(first).toBeGreaterThan(-1);
    expect(image).toBeGreaterThan(first);
    expect(last).toBeGreaterThan(image);
    expect(html).toContain('src="data:image/png;base64,aGVsbG8="');
  });
});
