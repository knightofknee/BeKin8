// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // .claude/worktrees holds full checkouts of this repo without their own node_modules, so
    // linting them reported hundreds of phantom import/no-unresolved errors that buried the real
    // findings. Anything under .claude is tooling scratch space, never shipped code.
    ignores: ['dist/*', '**/.claude/**'],
  },
]);
