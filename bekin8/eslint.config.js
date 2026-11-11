// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // .claude/worktrees holds full checkouts of this repo without their own node_modules, so
    // linting them reported hundreds of phantom import/no-unresolved errors that buried the real
    // findings. Anything under .claude is tooling scratch space, never shipped code.
    // Build output is not source: the web export (dist-web), compiled functions (functions/lib),
    // and the native projects. Linting them reported thousands of errors in generated bundles.
    ignores: ['dist/*', 'dist-web/**', 'functions/lib/**', 'ios/**', 'android/**', '.expo/**', '**/.claude/**'],
  },
  {
    // Node scripts (seed data, version flip, backfills) and config files run under Node, not RN.
    files: ['tools/**/*.js', '*.config.js'],
    languageOptions: { globals: { __dirname: 'readonly', process: 'readonly', require: 'readonly', module: 'writable', console: 'readonly' } },
  },
]);
