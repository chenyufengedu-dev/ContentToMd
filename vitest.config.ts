import { defineConfig } from 'vitest/config'

// 单元测试只测 src/core（不依赖 Tauri 的转换核心）
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
