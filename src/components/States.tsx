// 共用的載入與錯誤狀態。內容型區塊用骨架，不用轉圈圈。

/** 平台區的骨架：一張卡片的位置加上幾行列表 */
export function PlatformsSkeleton() {
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-label="正在讀取平台狀態">
      <div className="sk sk-title" />
      <div className="sk-rows">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="sk-row">
            <div className="sk sk-line" style={{ width: `${40 + ((i * 13) % 25)}%` }} />
            <div className="sk sk-bar" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 今天區塊的骨架 */
export function TodaySkeleton() {
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-label="正在讀取今天的行程與待辦">
      {Array.from({ length: 3 }, (_, block) => (
        <div key={block} className="sk-block">
          <div className="sk sk-label" />
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="sk sk-line" style={{ width: `${55 + ((block * 17 + i * 23) % 35)}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 讀取失敗：說明發生什麼事，並提供重試 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn-quiet btn-small" onClick={onRetry}>
          重試
        </button>
      )}
    </div>
  );
}
