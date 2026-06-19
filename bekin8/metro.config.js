// Import via `expo/metro-config` (re-export from the always-hoisted `expo` package) rather than
// `@expo/metro-config` directly — SDK 54 hoisting can leave @expo/metro-config nested under expo/.
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

// allow Firebase’s .cjs bundles to be resolved…
config.resolver.sourceExts.push('cjs');
// …and turn off strict exports field handling
config.resolver.unstable_enablePackageExports = false;

module.exports = config;