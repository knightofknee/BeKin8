/**
 * app.json with web-only switches (same pattern as Direct Democracy). The web version is hosted on
 * waldgrave.com under /bekin/app, so a web export sets expo-router's base path; native builds never
 * get it (it would be baked into their bundles too). The hosted export is a single-page app: every
 * screen reads the signed-in user, so pre-rendered HTML could never match the first browser render.
 * Export with `npm run export-web`; `npm run publish-web` copies it into the-waldgrave.
 */
module.exports = ({ config }) => {
  if (process.env.WEB_EXPORT !== '1') return config;
  return {
    ...config,
    web: { ...config.web, output: 'single' },
    experiments: { ...config.experiments, baseUrl: '/bekin/app' },
  };
};
