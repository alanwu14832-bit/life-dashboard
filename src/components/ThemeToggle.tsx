import { useState } from 'react';
import { applyTheme, readTheme, type ThemeChoice } from '../lib/theme';

const OPTIONS: [ThemeChoice, string][] = [
  ['auto', '自動'],
  ['light', '亮色'],
  ['dark', '深色'],
];

/** 頁尾的外觀切換。「自動」跟著手機或電腦的外觀設定。 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  return (
    <span className="theme-toggle" role="group" aria-label="外觀">
      外觀
      {OPTIONS.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={choice === v}
          onClick={() => {
            applyTheme(v);
            setChoice(v);
          }}
        >
          {label}
        </button>
      ))}
    </span>
  );
}
