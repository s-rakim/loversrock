const { withSettingsGradle } = require('@expo/config-plugins');

// Expo copies the app's display name ("loversrock.") into Android's
// rootProject.name. Gradle 8 rejects project names that start or end with a
// '.', which fails the build before anything compiles. This keeps the
// display name (launcher label, wordmark) and gives only the internal Gradle
// project a safe name.
module.exports = function withGradleProjectName(config, name = 'loversrock') {
  return withSettingsGradle(config, (cfg) => {
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /rootProject\.name\s*=\s*['"][^'"]*['"]/,
      `rootProject.name = '${name}'`
    );
    return cfg;
  });
};
