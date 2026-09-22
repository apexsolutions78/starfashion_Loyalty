const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist', 'node_modules', '*.config.js', 'jest.config.js', 'jest.integration.config.js'],
  },
  {
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
);
