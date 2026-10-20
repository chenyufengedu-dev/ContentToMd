// 代码规范检查：TypeScript 与 Vue 的推荐规则，外加《代码规范》里能自动拦的几条
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist/', 'src-tauri/', 's0/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    rules: {
      // 未定义的名字由 TypeScript 检查（typescript-eslint 官方建议关掉）
      'no-undef': 'off',
      // 《代码规范》第 1 节
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'default-case': 'error',
      'no-fallthrough': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      // 《代码规范》第 7 节第 5 条
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  prettier,
)
