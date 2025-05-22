const { getDefaultConfig } = require('@expo/metro-config');
const config = getDefaultConfig(__dirname);

// allow Firebase’s .cjs bundles to be resolved…
config.resolver.sourceExts.push('cjs');
// …and turn off strict exports field handling
config.resolver.unstable_enablePackageExports = false;

module.exports = config;