module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 6,
        sourceType: 'module',
    },
    plugins: [
        '@typescript-eslint',
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    rules: {
        '@typescript-eslint/naming-convention': 'warn',
        '@typescript-eslint/semi': 'warn',
        'curly': 'warn',
        'eqeqeq': 'warn',
        'no-throw-literal': 'warn',
        'semi': 'off',
    },
    overrides: [
        {
            // Model layer must not import vscode
            files: ['src/model/**/*.ts'],
            rules: {
                'no-restricted-imports': ['error', { patterns: ['vscode'] }],
            },
        },
        {
            // Presentation layer must not import from deleted src/db/
            files: ['src/providers/**/*.ts', 'src/views/**/*.ts', 'src/decorations/**/*.ts'],
            rules: {
                'no-restricted-imports': ['error', { patterns: ['../db/*', './db/*', '../../db/*'] }],
            },
        },
    ],
};
