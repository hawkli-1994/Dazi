import { describe, expect, it } from 'vitest';
import { dictionaries, Language, localize, localized, t } from './index';

describe('bilingual UI copy', () => {
  it('has a non-empty English and Chinese value for every key', () => {
    expect(Object.keys(dictionaries.zh).sort()).toEqual(Object.keys(dictionaries.en).sort());
    for (const dictionary of Object.values(dictionaries)) {
      for (const value of Object.values(dictionary)) expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it('interpolates values without losing zero counts', () => {
    expect(t(Language.English, 'briefingSummary', { active: 2, waiting: 0 })).toBe(
      '2 pieces of work in motion. 0 decisions for you.',
    );
    expect(t(Language.Chinese, 'briefingSummary', { active: 2, waiting: 0 })).toBe(
      '2 项工作在推进，0 件事等你决定。',
    );
  });

  it('leaves an absent substitution visible rather than inventing a value', () => {
    expect(t(Language.English, 'briefingSummary')).toContain('{active}');
  });

  it('selects authored translations and leaves user text unchanged', () => {
    const value = localized('你好', 'Hello');
    expect(localize(Language.Chinese, value)).toBe('你好');
    expect(localize(Language.English, value)).toBe('Hello');
    expect(localize(Language.English, '用户自己的文字')).toBe('用户自己的文字');
  });

  it('includes the accepted welcome concept and honest demo limitations', () => {
    expect(t(Language.Chinese, 'welcomeTitle')).toBe('把想法，寄往更远的地方。');
    expect(t(Language.English, 'demoNotice')).toContain('AI not connected');
    expect(t(Language.Chinese, 'scheduleDemoHint')).toContain('不会在后台触发');
  });
});
