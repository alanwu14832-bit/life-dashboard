import { describe, expect, it } from 'vitest';
import { validateProject, ValidationError } from '../worker/projects';

const base = { id: 'my-app', name: '我的 App', summary: '說明', repo: 'my-app', url: 'https://my-app.vercel.app', host: 'vercel' };

describe('設定頁送來的平台資料', () => {
  it('合格的資料整理後回傳', () => {
    expect(validateProject({ ...base, supabase: 'abcdefghijklmnopqrst', okStatus: [401], notes: 'https://app.notion.com/p/abc', domain: 'Example.TW' })).toEqual({
      id: 'my-app', name: '我的 App', summary: '說明', repo: 'my-app', url: 'https://my-app.vercel.app/', host: 'vercel',
      supabase: 'abcdefghijklmnopqrst', domain: 'example.tw', okStatus: [401], notes: 'https://app.notion.com/p/abc', paused: false,
    });
  });
  it('網址可以留空', () => {
    expect(validateProject({ ...base, url: '' }).url).toBeNull();
  });
  const bad: [string, Record<string, unknown>, string][] = [
    ['代號有大寫', { id: 'My_App' }, '代號'],
    ['沒有名稱', { name: '  ' }, '名稱'],
    ['repo 帶了擁有者', { repo: 'me/my-app' }, 'repo'],
    ['主機亂填', { host: 'aws' }, '主機'],
    ['網址不是 https', { url: 'http://x.com' }, 'https'],
    ['網址亂填', { url: 'not a url' }, '網址'],
    ['Supabase 代號長度不對', { supabase: 'abc' }, 'Supabase'],
    ['網域帶了 https', { domain: 'https://x.tw' }, '網域'],
    ['狀態碼超出範圍', { okStatus: [999] }, '狀態碼'],
    ['筆記不是 Notion', { notes: 'https://evil.test/x' }, 'Notion'],
  ];
  for (const [label, patch, msg] of bad) {
    it(`擋下：${label}`, () => {
      expect(() => validateProject({ ...base, ...patch })).toThrow(ValidationError);
      expect(() => validateProject({ ...base, ...patch })).toThrow(msg);
    });
  }
});
