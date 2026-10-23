import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// 核心默认用 node；交互测试按文件声明 jsdom，外壳接口由测试替身隔离。
export default defineConfig({
  plugins: [vue()],
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
