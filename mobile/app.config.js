// Extends app.json rather than replacing it: Expo reads this file and passes
// the static app.json config in as `config`.
//
// The point is `extra.commit`. EAS sets EAS_BUILD_GIT_COMMIT_HASH on the build
// machine, so the exact commit a binary was built from gets baked into the
// bundle and rendered on the login screen. Without it, "is the app the latest
// build?" can only be answered by cross-referencing the EAS dashboard by hand,
// which is how an old APK went unnoticed for several rounds.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    commit: (process.env.EAS_BUILD_GIT_COMMIT_HASH || '').slice(0, 7) || 'local',
  },
});
