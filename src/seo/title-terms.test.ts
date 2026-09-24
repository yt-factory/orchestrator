import { test, expect, describe } from 'bun:test';
import { pickTitleTerms } from './title-terms';

describe('pickTitleTerms', () => {
  test('ep115: well-formed koan (csConceptZh=zh, csConceptEn=en as expected)', () => {
    const koan = { chineseName: '告警疲劳', csConceptZh: '告警疲劳', csConceptEn: 'Alert Fatigue' };
    expect(pickTitleTerms(koan)).toEqual({ zh: '告警疲劳', en: 'Alert Fatigue' });
  });

  test('ep140: chineseName is English, csConceptEn bracket actually holds Chinese', () => {
    const koan = { chineseName: 'Keep-Alive', csConceptZh: 'Keep-Alive', csConceptEn: '保活' };
    expect(pickTitleTerms(koan)).toEqual({ zh: '保活', en: 'Keep-Alive' });
  });

  test('ep116: csConceptZh/csConceptEn reversed from convention', () => {
    const koan = { chineseName: 'SLO', csConceptZh: 'SLO', csConceptEn: '服务水平目标' };
    expect(pickTitleTerms(koan)).toEqual({ zh: '服务水平目标', en: 'SLO' });
  });

  test('ep108: no bracket in H2, csConceptEn empty', () => {
    const koan = { chineseName: 'Sidecar', csConceptZh: 'Sidecar模式', csConceptEn: '' };
    expect(pickTitleTerms(koan)).toEqual({ zh: 'Sidecar模式', en: 'Sidecar' });
  });

  test('ep106: csConceptZh/csConceptEn reversed from convention', () => {
    const koan = { chineseName: 'CQRS', csConceptZh: 'CQRS', csConceptEn: '命令查询分离' };
    expect(pickTitleTerms(koan)).toEqual({ zh: '命令查询分离', en: 'CQRS' });
  });

  test('no CJK anywhere -> zh is empty, en picks csConceptEn first', () => {
    const koan = { chineseName: 'Foo', csConceptZh: 'Foo', csConceptEn: 'Bar' };
    expect(pickTitleTerms(koan)).toEqual({ zh: '', en: 'Bar' });
  });

  test('all fields empty -> both empty', () => {
    const koan = { chineseName: '', csConceptZh: '', csConceptEn: '' };
    expect(pickTitleTerms(koan)).toEqual({ zh: '', en: '' });
  });

  test('trims whitespace before evaluating candidates', () => {
    const koan = { chineseName: '  告警疲劳  ', csConceptZh: '', csConceptEn: ' Alert Fatigue ' };
    expect(pickTitleTerms(koan)).toEqual({ zh: '告警疲劳', en: 'Alert Fatigue' });
  });
});
