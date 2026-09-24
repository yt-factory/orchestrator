import { test, expect, describe } from 'bun:test';
import { renderDescription } from './description';

const koan = { chineseName: '空间换时间', csConceptZh: '空间换时间', csConceptEn: 'Space-Time Tradeoff' };
const common = {
  koan,
  llm_hook_paragraph: '一段引子，落在人生的共鳴上。',
  chapters: '',
  hashtags: ['极客禅', 'GeekZen'],
};

describe('renderDescription', () => {
  test('zh_TW uses Traditional Chinese vocabulary (bug guard for script mixing)', () => {
    const out = renderDescription({ locale: 'zh_TW', ...common });
    expect(out).toContain('程式設計師');
    expect(out).not.toContain('程序员'); // the original mixed-script bug
    expect(out).toContain('關於極客禪');
    expect(out).toContain('講禪宗公案');
    expect(out).toContain('空間換時間'); // koan name converted via toTraditional filter
    expect(out).toContain('#極客禪'); // hashtag converted too
  });

  test('zh_CN_XHS uses Simplified + XHS-safe vocabulary', () => {
    const out = renderDescription({ locale: 'zh_CN_XHS', ...common });
    expect(out).toContain('程序员');
    expect(out).not.toContain('程式設計師');
    expect(out).not.toContain('崩溃'); // XHS-banned words must not appear in the frame
    expect(out).not.toContain('死循环');
    expect(out).not.toContain('震惊');
    expect(out).toContain('#极客禅'); // stays Simplified
  });

  test('zh_TW and zh_CN_XHS render different strings (bug guard for the 5-copy issue)', () => {
    const tw = renderDescription({ locale: 'zh_TW', ...common });
    const xhs = renderDescription({ locale: 'zh_CN_XHS', ...common });
    expect(tw).not.toBe(xhs);
  });

  describe('first line — cs_concept_en lead-in', () => {
    test('zh_TW: first line is "{en} —— 本期公案：{name}" when csConceptEn is present', () => {
      const out = renderDescription({ locale: 'zh_TW', ...common });
      expect(out.split('\n')[0]).toBe('Space-Time Tradeoff —— 本期公案：空間換時間');
    });

    test('zh_CN_XHS: first line is "{en} —— 本期公案：{name}" when csConceptEn is present', () => {
      const out = renderDescription({ locale: 'zh_CN_XHS', ...common });
      expect(out.split('\n')[0]).toBe('Space-Time Tradeoff —— 本期公案：空间换时间');
    });

    test('zh_TW: falls back to "本期公案：{name}" with no dangling " —— " when csConceptEn is empty', () => {
      const out = renderDescription({
        locale: 'zh_TW',
        ...common,
        koan: { ...koan, csConceptEn: '' },
      });
      const firstLine = out.split('\n')[0];
      expect(firstLine).toBe('本期公案：空間換時間');
      expect(firstLine).not.toContain('——');
    });

    test('zh_CN_XHS: falls back to "本期公案：{name}" with no dangling " —— " when csConceptEn is empty', () => {
      const out = renderDescription({
        locale: 'zh_CN_XHS',
        ...common,
        koan: { ...koan, csConceptEn: '' },
      });
      const firstLine = out.split('\n')[0];
      expect(firstLine).toBe('本期公案：空间换时间');
      expect(firstLine).not.toContain('——');
    });

    test('rest of the template is unchanged (only the first line differs)', () => {
      const withEn = renderDescription({ locale: 'zh_TW', ...common });
      const withoutEn = renderDescription({
        locale: 'zh_TW',
        ...common,
        koan: { ...koan, csConceptEn: '' },
      });
      const restWithEn = withEn.split('\n').slice(2).join('\n');
      const restWithoutEn = withoutEn.split('\n').slice(2).join('\n');
      // Line 1 (cs_concept_zh) still embeds csConceptEn in parens, so compare
      // from line 3 onward, which is fully independent of csConceptEn.
      expect(restWithEn).toBe(restWithoutEn);
    });
  });
});
