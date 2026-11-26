import { describe, expect, it } from 'vitest';
import { eventsBetween, eventsFromIcs, parseIcs } from '../worker/ics';

const cal = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e.trim().split('\n').map((l) => l.trim()), 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

const titles = (ics: string, from: string, days = 7) => eventsFromIcs(ics, from, days).map((e) => `${e.start} ${e.title}`);

// 2026-11-26 是星期四
describe('單次行程', () => {
  it('台北時間的行程換成 UTC', () => {
    const ics = cal(`UID:a\nDTSTART;TZID=Asia/Taipei:20261126T090000\nDTEND;TZID=Asia/Taipei:20261126T101000\nSUMMARY:會計學`);
    const [e] = eventsBetween(parseIcs(ics), '2026-11-26', 1);
    expect(e).toEqual({ title: '會計學', location: null, allDay: false, start: '2026-11-26T01:00:00.000Z', end: '2026-11-26T02:10:00.000Z' });
  });

  it('UTC 寫法（結尾 Z）也正確', () => {
    const ics = cal(`UID:a\nDTSTART:20261126T060000Z\nDTEND:20261126T070000Z\nSUMMARY:面試`);
    expect(eventsBetween(parseIcs(ics), '2026-11-26', 1)[0].start).toBe('2026-11-26T06:00:00.000Z');
  });

  it('範圍外的不列出；台北凌晨的行程算在當天', () => {
    const ics = cal(
      `UID:a\nDTSTART;TZID=Asia/Taipei:20261126T003000\nDTEND;TZID=Asia/Taipei:20261126T010000\nSUMMARY:凌晨`,
      `UID:b\nDTSTART;TZID=Asia/Taipei:20261125T230000\nDTEND;TZID=Asia/Taipei:20261125T233000\nSUMMARY:昨天`,
      `UID:c\nDTSTART;TZID=Asia/Taipei:20261203T090000\nDTEND;TZID=Asia/Taipei:20261203T100000\nSUMMARY:第八天`,
    );
    expect(titles(ics, '2026-11-26')).toEqual(['2026-11-25T16:30:00.000Z 凌晨']);
  });

  it('整天的行程用日期表示，排在當天最前面', () => {
    const ics = cal(
      `UID:a\nDTSTART;TZID=Asia/Taipei:20261126T080000\nDTEND;TZID=Asia/Taipei:20261126T090000\nSUMMARY:早上`,
      `UID:b\nDTSTART;VALUE=DATE:20261126\nDTEND;VALUE=DATE:20261127\nSUMMARY:期中考週`,
    );
    expect(titles(ics, '2026-11-26', 1)).toEqual(['2026-11-26 期中考週', '2026-11-26T00:00:00.000Z 早上']);
  });

  it('跨多天的整天行程，只要有重疊就列出', () => {
    const ics = cal(`UID:a\nDTSTART;VALUE=DATE:20261120\nDTEND;VALUE=DATE:20261128\nSUMMARY:展覽`);
    expect(titles(ics, '2026-11-26', 1)).toEqual(['2026-11-20 展覽']);
  });

  it('取消的行程不列出', () => {
    const ics = cal(`UID:a\nDTSTART;TZID=Asia/Taipei:20261126T090000\nDTEND;TZID=Asia/Taipei:20261126T100000\nSTATUS:CANCELLED\nSUMMARY:取消`);
    expect(titles(ics, '2026-11-26')).toEqual([]);
  });

  it('處理折行與跳脫字元，忽略提醒裡的欄位', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:a',
      'DTSTART;TZID=Asia/Taipei:20261126T090000',
      'DTEND;TZID=Asia/Taipei:20261126T100000',
      'SUMMARY:中級會計學\\, 第十',
      ' 二週',
      'LOCATION:管理學院一館 \\; 101',
      'BEGIN:VALARM',
      'SUMMARY:提醒不是標題',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [e] = eventsBetween(parseIcs(ics), '2026-11-26', 1);
    expect(e.title).toBe('中級會計學, 第十二週');
    expect(e.location).toBe('管理學院一館 ; 101');
  });
});

describe('重複行程', () => {
  const weekly = `UID:class\nDTSTART;TZID=Asia/Taipei:20260903T091000\nDTEND;TZID=Asia/Taipei:20260903T120000\nRRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20270110T155959Z\nSUMMARY:中級會計學`;

  it('每週二、四的課，展開成這週的兩堂', () => {
    expect(titles(cal(weekly), '2026-11-26')).toEqual(['2026-11-26T01:10:00.000Z 中級會計學', '2026-12-01T01:10:00.000Z 中級會計學']);
  });

  it('EXDATE 停課的那天不列出', () => {
    const ics = cal(`${weekly}\nEXDATE;TZID=Asia/Taipei:20261126T091000`);
    expect(titles(ics, '2026-11-26')).toEqual(['2026-12-01T01:10:00.000Z 中級會計學']);
  });

  it('單次改時間（RECURRENCE-ID）用改過的那筆取代', () => {
    const ics = cal(
      weekly,
      `UID:class\nRECURRENCE-ID;TZID=Asia/Taipei:20261126T091000\nDTSTART;TZID=Asia/Taipei:20261126T140000\nDTEND;TZID=Asia/Taipei:20261126T170000\nSUMMARY:中級會計學（補課）`,
    );
    expect(titles(ics, '2026-11-26')).toEqual(['2026-11-26T06:00:00.000Z 中級會計學（補課）', '2026-12-01T01:10:00.000Z 中級會計學']);
  });

  it('UNTIL 之後不再出現', () => {
    expect(titles(cal(weekly), '2027-01-11')).toEqual([]);
  });

  it('COUNT 用完就停', () => {
    const ics = cal(`UID:a\nDTSTART;TZID=Asia/Taipei:20261119T190000\nDTEND;TZID=Asia/Taipei:20261119T200000\nRRULE:FREQ=WEEKLY;COUNT=2\nSUMMARY:社課`);
    expect(titles(ics, '2026-11-26', 14)).toEqual(['2026-11-26T11:00:00.000Z 社課']);
  });

  it('隔週（INTERVAL=2）', () => {
    const ics = cal(`UID:a\nDTSTART;TZID=Asia/Taipei:20261112T190000\nDTEND;TZID=Asia/Taipei:20261112T200000\nRRULE:FREQ=WEEKLY;INTERVAL=2\nSUMMARY:隔週會議`);
    expect(titles(ics, '2026-11-19', 14)).toEqual(['2026-11-26T11:00:00.000Z 隔週會議']);
  });

  it('每天', () => {
    const ics = cal(`UID:a\nDTSTART;TZID=Asia/Taipei:20260101T070000\nDTEND;TZID=Asia/Taipei:20260101T073000\nRRULE:FREQ=DAILY\nSUMMARY:晨跑`);
    expect(titles(ics, '2026-11-26', 2)).toEqual(['2026-11-25T23:00:00.000Z 晨跑', '2026-11-26T23:00:00.000Z 晨跑']);
  });

  it('每月第一個星期一、每月最後一個星期五', () => {
    const ics = cal(
      `UID:a\nDTSTART;TZID=Asia/Taipei:20260105T120000\nDTEND;TZID=Asia/Taipei:20260105T130000\nRRULE:FREQ=MONTHLY;BYDAY=1MO\nSUMMARY:月會`,
      `UID:b\nDTSTART;TZID=Asia/Taipei:20260130T180000\nDTEND;TZID=Asia/Taipei:20260130T190000\nRRULE:FREQ=MONTHLY;BYDAY=-1FR\nSUMMARY:月底聚餐`,
    );
    expect(titles(ics, '2026-11-26', 12)).toEqual(['2026-11-27T10:00:00.000Z 月底聚餐', '2026-12-07T04:00:00.000Z 月會']);
  });

  it('每年（生日，整天）', () => {
    const ics = cal(`UID:a\nDTSTART;VALUE=DATE:20001127\nDTEND;VALUE=DATE:20001128\nRRULE:FREQ=YEARLY\nSUMMARY:生日`);
    expect(titles(ics, '2026-11-26')).toEqual(['2026-11-27 生日']);
  });

  it('其他時區的重複行程照當地時間換算（美東夏令時間結束前後）', () => {
    const ics = cal(`UID:a\nDTSTART;TZID=America/New_York:20261026T090000\nDTEND;TZID=America/New_York:20261026T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO\nSUMMARY:美東會議`);
    // 11/2 起美東為 UTC-5：09:00 = 14:00Z
    expect(titles(ics, '2026-11-30', 1)).toEqual(['2026-11-30T14:00:00.000Z 美東會議']);
  });
});

describe('效能', () => {
  it('3000 筆行程的行事曆，解析加展開夠快（取三次最快的一次，避免 CI 機器忽快忽慢造成誤判）', () => {
    const many: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      const month = String((i % 12) + 1).padStart(2, '0');
      const year = 2020 + (i % 7);
      many.push(
        `UID:e${i}\nDTSTART;TZID=Asia/Taipei:${year}${month}${day}T090000\nDTEND;TZID=Asia/Taipei:${year}${month}${day}T100000\nSUMMARY:行程 ${i}\nDESCRIPTION:${'說明文字'.repeat(20)}${i % 10 === 0 ? '\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE' : ''}`,
      );
    }
    const ics = cal(...many);
    let best = Infinity;
    let events: ReturnType<typeof eventsFromIcs> = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      events = eventsFromIcs(ics, '2026-11-26', 7);
      best = Math.min(best, performance.now() - t0);
    }
    expect(events.length).toBeGreaterThan(0);
    // 本機約 10ms；舊的寫法要 200ms 以上。門檻放寬到 80ms，只抓真正變慢的改動
    expect(best).toBeLessThan(80);
  });
});
