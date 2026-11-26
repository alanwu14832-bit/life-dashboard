// 輕量 iCalendar 解析：只取出某段日期內的行程，包含每週重複的課。
// 不用完整套件，是為了讓 Cloudflare 免費方案每次請求 10ms 的 CPU 上限夠用：
// 只讀用得到的欄位、太舊的單次行程不解析日期、重複行程直接跳到查詢範圍附近再展開。

import { TAIPEI, ymdIn, zonedToUtc } from './time';

export interface CalEvent {
  title: string;
  location: string | null;
  allDay: boolean;
  /** 整天的行程是 YYYY-MM-DD（結束日不含）；有時間的是 ISO（UTC） */
  start: string;
  end: string;
}

interface DateVal {
  allDay: boolean;
  /** 當地日期的日序（1970-01-01 起算的天數） */
  day: number;
  h: number;
  mi: number;
  s: number;
  tz: string;
  /** 有時間的行程換成 UTC 的毫秒；整天的是 0 */
  ms: number;
}

interface RawProp {
  value: string;
  params: string;
}

export interface RawEvent {
  uid: string;
  summary: string;
  location: string | null;
  status: string | null;
  start: DateVal;
  end: DateVal | null;
  duration: number | null;
  rrule: Record<string, string> | null;
  exdates: DateVal[];
  recurrenceId: DateVal | null;
}

const DAY_MS = 86_400_000;
const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** 日序 ↔ 日期 */
export function dayOf(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / DAY_MS;
}
export function dayFromYmd(ymd: string): number {
  return dayOf(+ymd.slice(0, 4), +ymd.slice(5, 7), +ymd.slice(8, 10));
}
function ymdOf(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function partsOf(day: number): [number, number, number] {
  const d = new Date(day * DAY_MS);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}
/** 星期幾，0 = 星期日（1970-01-01 是星期四） */
const dow = (day: number) => (((day + 4) % 7) + 7) % 7;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const unescapeText = (s: string) =>
  s.indexOf('\\') < 0 ? s : s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

function paramOf(params: string, key: string): string | null {
  const i = params.indexOf(`;${key}=`);
  if (i < 0) return null;
  const rest = params.slice(i + key.length + 2);
  const end = rest.indexOf(';');
  return (end < 0 ? rest : rest.slice(0, end)).replace(/^"|"$/g, '');
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

function parseDate(value: string, params: string): DateVal | null {
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const day = dayOf(y, mo, d);
  if (m[4] === undefined || paramOf(params, 'VALUE') === 'DATE')
    return { allDay: true, day, h: 0, mi: 0, s: 0, tz: TAIPEI, ms: 0 };
  const h = +m[4];
  const mi = +m[5];
  const s = +m[6];
  const tz = m[7] ? 'UTC' : paramOf(params, 'TZID') || TAIPEI;
  const ms = tz === 'UTC' ? Date.UTC(y, mo - 1, d, h, mi, s) : zonedToUtc(y, mo, d, h, mi, s, tz);
  return { allDay: false, day, h, mi, s, tz, ms };
}

function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86_400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

/** 只讀這些欄位，其他（DESCRIPTION、ATTENDEE…）直接跳過 */
const WANTED = ['UID', 'SUMMARY', 'LOCATION', 'STATUS', 'DTSTART', 'DTEND', 'DURATION', 'RRULE', 'EXDATE', 'RECURRENCE-ID'];

function wantedName(line: string): string | null {
  for (const name of WANTED) {
    if (line.startsWith(name)) {
      const c = line.charCodeAt(name.length);
      if (c === 58 /* : */ || c === 59 /* ; */) return name;
    }
  }
  return null;
}

/** 只看前兩個字母快速排除：B(EGIN) E(ND/XDATE) U(ID) S(UMMARY/TATUS) L(OCATION) DT/DU R(RULE/ECURRENCE-ID) */
function maybeWanted(text: string, pos: number): boolean {
  switch (text.charCodeAt(pos)) {
    case 66: // B
    case 69: // E
    case 85: // U
    case 83: // S
    case 76: // L
    case 82: // R
      return true;
    case 68: {
      // D：只要 DT… 與 DU…，跳過 DESCRIPTION
      const c1 = text.charCodeAt(pos + 1);
      return c1 === 84 || c1 === 85;
    }
    default:
      return false;
  }
}

/** 把「名稱;參數:值」拆開；參數裡被引號包住的冒號不算。 */
function splitValue(line: string, nameLen: number): RawProp | null {
  let inQuote = false;
  for (let i = nameLen; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 34) inQuote = !inQuote;
    else if (c === 58 && !inQuote) return { params: line.slice(nameLen, i), value: line.slice(i + 1) };
  }
  return null;
}

/**
 * 解析行事曆。給了 minDay 時，結束在那天之前的單次行程不解析，省下大部分時間。
 */
export function parseIcs(text: string, minDay = -Infinity): RawEvent[] {
  const events: RawEvent[] = [];
  let props: Map<string, RawProp> | null = null;
  let exdates: RawProp[] = [];
  let depth = 0;
  let pending: string | null = null; // 折行：下一行開頭是空白就接回上一行

  const finish = () => {
    if (!props) return;
    const dtstart = props.get('DTSTART');
    if (!dtstart) return;
    const rruleRaw = props.get('RRULE');
    const recRaw = props.get('RECURRENCE-ID');
    if (!rruleRaw && !recRaw) {
      // 太舊的單次行程：只看日期字串就丟掉
      const endRaw = props.get('DTEND') ?? dtstart;
      const v = endRaw.value;
      if (v.length >= 8 && dayOf(+v.slice(0, 4), +v.slice(4, 6), +v.slice(6, 8)) < minDay) return;
    }
    const start = parseDate(dtstart.value, dtstart.params);
    if (!start) return;
    const endRaw = props.get('DTEND');
    const durRaw = props.get('DURATION');
    events.push({
      uid: props.get('UID')?.value ?? '',
      summary: unescapeText(props.get('SUMMARY')?.value ?? ''),
      location: props.get('LOCATION') ? unescapeText(props.get('LOCATION')!.value) || null : null,
      status: props.get('STATUS')?.value.toUpperCase() ?? null,
      start,
      end: endRaw ? parseDate(endRaw.value, endRaw.params) : null,
      duration: durRaw ? parseDuration(durRaw.value) : null,
      rrule: rruleRaw
        ? Object.fromEntries(
            rruleRaw.value.split(';').map((kv) => {
              const i = kv.indexOf('=');
              return [kv.slice(0, i).toUpperCase(), kv.slice(i + 1)];
            }),
          )
        : null,
      exdates: exdates.flatMap((p) =>
        p.value.split(',').flatMap((v) => {
          const d = parseDate(v, p.params);
          return d ? [d] : [];
        }),
      ),
      recurrenceId: recRaw ? parseDate(recRaw.value, recRaw.params) : null,
    });
  };

  const handle = (line: string) => {
    if (line === 'BEGIN:VEVENT') {
      props = new Map();
      exdates = [];
      depth = 0;
      return;
    }
    if (!props) return;
    if (line === 'END:VEVENT') {
      finish();
      props = null;
      return;
    }
    if (line.startsWith('BEGIN:')) depth++;
    else if (line.startsWith('END:')) depth--;
    if (depth > 0) return;
    const name = wantedName(line);
    if (!name) return;
    const p = splitValue(line, name.length);
    if (!p) return;
    if (name === 'EXDATE') exdates.push(p);
    else props.set(name, p);
  };

  let pos = 0;
  const len = text.length;
  let skipping = false; // 上一行是不需要的欄位（例如很長的 DESCRIPTION），它的折行也跳過
  while (pos < len) {
    let nl = text.indexOf('\n', pos);
    if (nl < 0) nl = len;
    const c0 = text.charCodeAt(pos);
    if (c0 === 32 || c0 === 9) {
      if (!skipping && pending !== null) {
        let cont = text.slice(pos + 1, nl);
        if (cont.charCodeAt(cont.length - 1) === 13) cont = cont.slice(0, -1);
        pending += cont;
      }
      pos = nl + 1;
      continue;
    }
    if (pending !== null) handle(pending);
    pending = null;
    // 先看開頭字母，確定用不到的行連字串都不切
    if (!maybeWanted(text, pos)) {
      skipping = true;
      pos = nl + 1;
      continue;
    }
    skipping = false;
    let line = text.slice(pos, nl);
    if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
    pending = line;
    pos = nl + 1;
  }
  if (pending !== null) handle(pending);
  return events;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_ITER = 2000;

/** 某月第 n 個星期幾（n 為負數代表倒數），回傳日；不存在回傳 null。 */
function nthWeekday(y: number, m: number, wd: number, n: number): number | null {
  const dim = daysInMonth(y, m);
  if (n > 0) {
    const day = 1 + ((wd - dow(dayOf(y, m, 1)) + 7) % 7) + (n - 1) * 7;
    return day <= dim ? day : null;
  }
  const day = dim - ((dow(dayOf(y, m, dim)) - wd + 7) % 7) + (n + 1) * 7;
  return day >= 1 ? day : null;
}

/**
 * 依 RRULE 產生發生日（日序），從 DTSTART 起、到 stopDay 為止（含）。
 * 沒有 COUNT 時直接跳到 fromDay 附近，不必從好幾年前一週一週算過來。
 * 支援 DAILY / WEEKLY / MONTHLY / YEARLY、INTERVAL、COUNT、UNTIL、BYDAY、BYMONTHDAY、BYMONTH。
 */
function occurrenceDays(startDay: number, rule: Record<string, string>, fromDay: number, stopDay: number): number[] {
  const out: number[] = [];
  const freq = rule.FREQ;
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  const canSkip = count === Infinity;
  const byday = rule.BYDAY ? rule.BYDAY.split(',') : null;
  const bymonthday = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null;
  const bymonth = rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : null;
  let n = 0;
  let iter = 0;
  const emit = (day: number) => {
    if (day < startDay || day > stopDay || n >= count) return;
    n++;
    out.push(day);
  };

  if (freq === 'DAILY') {
    let d = startDay;
    if (canSkip && fromDay > d) d += Math.floor((fromDay - d) / interval) * interval;
    for (; d <= stopDay && n < count && iter++ < MAX_ITER; d += interval) {
      if (bymonth && !bymonth.includes(partsOf(d)[1])) continue;
      if (byday && !byday.some((c) => c.slice(-2) === DAY_CODES[dow(d)])) continue;
      emit(d);
    }
  } else if (freq === 'WEEKLY') {
    const wkst = DAY_CODES.indexOf(rule.WKST ?? 'MO');
    const offsets = (byday ?? [DAY_CODES[dow(startDay)]])
      .map((c) => DAY_CODES.indexOf(c.slice(-2)))
      .filter((x) => x >= 0)
      .map((wd) => (wd - wkst + 7) % 7)
      .sort((a, b) => a - b);
    let ws = startDay - ((dow(startDay) - wkst + 7) % 7);
    const step = 7 * interval;
    if (canSkip && fromDay - 7 > ws) ws += Math.floor((fromDay - 7 - ws) / step) * step;
    for (; ws <= stopDay && n < count && iter++ < MAX_ITER; ws += step) for (const o of offsets) emit(ws + o);
  } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
    let [y, m] = partsOf(startDay);
    const [, startMonth, startDate] = partsOf(startDay);
    const monthStep = freq === 'MONTHLY' ? interval : 12 * interval;
    if (canSkip) {
      // 跳到查詢範圍前一年附近，保持在 interval 的節奏上
      const [fy, fm] = partsOf(fromDay);
      const gap = (fy - y) * 12 + (fm - m) - 12;
      if (gap > 0) {
        const jump = Math.floor(gap / monthStep) * monthStep;
        m += jump;
        y += Math.floor((m - 1) / 12);
        m = ((m - 1) % 12) + 1;
      }
    }
    while (n < count && iter++ < MAX_ITER && dayOf(y, m, 1) <= stopDay) {
      const monthOk = freq === 'MONTHLY' ? !bymonth || bymonth.includes(m) : (bymonth ?? [startMonth]).includes(m);
      if (monthOk) {
        let dates: number[] = [];
        if (byday) {
          for (const code of byday) {
            const mm = /^([+-]?\d+)?([A-Z]{2})$/.exec(code);
            if (!mm) continue;
            const wd = DAY_CODES.indexOf(mm[2]);
            if (mm[1]) {
              const d = nthWeekday(y, m, wd, Number(mm[1]));
              if (d) dates.push(d);
            } else {
              for (let d = 1 + ((wd - dow(dayOf(y, m, 1)) + 7) % 7); d <= daysInMonth(y, m); d += 7) dates.push(d);
            }
          }
        } else if (bymonthday) {
          const dim = daysInMonth(y, m);
          dates = bymonthday.map((d) => (d < 0 ? dim + d + 1 : d)).filter((d) => d >= 1 && d <= dim);
        } else if (startDate <= daysInMonth(y, m)) {
          dates = [startDate];
        }
        for (const d of [...new Set(dates)].sort((a, b) => a - b)) emit(dayOf(y, m, d));
      }
      // 有 BYMONTH 的年度規則逐月檢查；其他照 interval 跳
      const stepNow = freq === 'YEARLY' && bymonth ? (m === 12 ? 1 + 12 * (interval - 1) : 1) : monthStep;
      m += stepNow;
      y += Math.floor((m - 1) / 12);
      m = ((m - 1) % 12) + 1;
    }
  } else {
    emit(startDay);
  }
  return out;
}

const instanceKey = (allDay: boolean, day: number, ms: number) => (allDay ? `d${day}` : `t${ms}`);

/** 解析並取出從 fromYmd 起 days 天內的行程（台北日期），依開始時間排序。 */
export function eventsFromIcs(text: string, fromYmd: string, days: number): CalEvent[] {
  const fromDay = dayFromYmd(fromYmd);
  return eventsBetween(parseIcs(text, fromDay - 1), fromYmd, days);
}

export function eventsBetween(raw: RawEvent[], fromYmd: string, days: number): CalEvent[] {
  const fromDay = dayFromYmd(fromYmd);
  const toDay = fromDay + days; // 不含
  const winStart = zonedToUtc(...partsOf(fromDay), 0, 0, 0, TAIPEI);
  const winEnd = zonedToUtc(...partsOf(toDay), 0, 0, 0, TAIPEI);

  // 單次修改過的重複行程：同 UID、帶 RECURRENCE-ID
  const overridden = new Map<string, Set<string>>();
  for (const e of raw) {
    if (!e.recurrenceId) continue;
    const set = overridden.get(e.uid) ?? new Set<string>();
    set.add(instanceKey(e.recurrenceId.allDay, e.recurrenceId.day, e.recurrenceId.ms));
    overridden.set(e.uid, set);
  }

  const out: (CalEvent & { key: number })[] = [];
  const push = (e: RawEvent, day: number, startMs: number) => {
    const s = e.start;
    if (s.allDay) {
      const lenDays = e.end?.allDay
        ? Math.max(1, e.end.day - s.day)
        : e.duration
          ? Math.max(1, Math.round(e.duration / DAY_MS))
          : 1;
      if (day < toDay && day + lenDays > fromDay)
        out.push({
          title: e.summary || '（無標題）',
          location: e.location,
          allDay: true,
          start: ymdOf(day),
          end: ymdOf(day + lenDays),
          key: zonedToUtc(...partsOf(day), 0, 0, 0, TAIPEI) - 1,
        });
    } else {
      const len = e.end && !e.end.allDay ? e.end.ms - s.ms : (e.duration ?? 0);
      const endMs = startMs + Math.max(0, len);
      if (startMs < winEnd && (endMs > winStart || startMs >= winStart))
        out.push({
          title: e.summary || '（無標題）',
          location: e.location,
          allDay: false,
          start: new Date(startMs).toISOString(),
          end: new Date(endMs).toISOString(),
          key: startMs,
        });
    }
  };

  for (const e of raw) {
    const s = e.start;
    if (e.status === 'CANCELLED') continue;
    if (!e.rrule || e.recurrenceId) {
      push(e, s.day, s.ms);
      continue;
    }
    const ex = new Set(e.exdates.map((d) => instanceKey(s.allDay, d.day, s.allDay ? 0 : d.ms)));
    const skip = overridden.get(e.uid);
    let stopDay = toDay + 1; // 多看一天，給跨時區的行程
    if (e.rrule.UNTIL) {
      const u = parseDate(e.rrule.UNTIL, s.allDay ? ';VALUE=DATE' : '');
      if (u) stopDay = Math.min(stopDay, u.allDay ? u.day : dayFromYmd(ymdIn(u.ms, s.tz === 'UTC' ? 'UTC' : s.tz)));
    }
    // 長達好幾天的整天重複行程很少見，往前看 31 天就夠
    for (const day of occurrenceDays(s.day, e.rrule, fromDay - 31, stopDay)) {
      let ms = 0;
      if (!s.allDay) {
        const [y, m, d] = partsOf(day);
        ms = s.tz === 'UTC' ? Date.UTC(y, m - 1, d, s.h, s.mi, s.s) : zonedToUtc(y, m, d, s.h, s.mi, s.s, s.tz);
      }
      const key = instanceKey(s.allDay, day, ms);
      if (ex.has(key) || skip?.has(key)) continue;
      push(e, day, ms);
    }
  }

  // 整天的行程排在當天最前面
  return out.sort((a, b) => a.key - b.key).map(({ key: _key, ...e }) => e);
}
