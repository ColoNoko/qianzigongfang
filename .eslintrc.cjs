module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true
  },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 2022,
    sourceType: 'module',
    extraFileExtensions: ['.vue']
  },
  extends: [
    'eslint:recommended',
    'plugin:vue/vue3-recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  plugins: ['@typescript-eslint', 'vue'],
  /**
   * 构建期注入的全局（vite `define`，真源见 electron.vite.config.ts）——
   * ESLint 不认识它们，得在这里登记，否则 `no-undef` 会报错。
   */
  globals: {
    __APP_VERSION__: 'readonly'
  },
  ignorePatterns: ['out', 'dist', 'node_modules', 'oldcode'],
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'warn',
    'vue/multi-word-component-names': 'off',
    'vue/html-self-closing': 'off',
    'vue/max-attributes-per-line': 'off',
    'vue/singleline-html-element-content-newline': 'off',
    'vue/html-indent': 'off',
    'vue/attributes-order': 'off',
    'vue/html-closing-bracket-newline': 'off',
    'vue/first-attribute-linebreak': 'off'
  },
  overrides: [
    {
      // Test files: relax `any` and unused-var rules. Specs intentionally
      // mock external bridges (window.comicType, OffscreenCanvas, ag-psd
      // factories) with loose shapes; strict typing adds noise without
      // catching real bugs in test code.
      files: ['**/__tests__/**/*.ts', '**/__tests__/**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off'
      }
    }
  ]
}
