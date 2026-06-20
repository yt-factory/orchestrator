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
});
