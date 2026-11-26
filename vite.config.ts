import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 本機開發：`npm run dev` 起前端，API 轉給 `wrangler dev`（預設 8787）
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { include: ['tests/**/*.test.ts'] },
});
