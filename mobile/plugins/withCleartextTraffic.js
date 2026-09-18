const { withAndroidManifest, withInfoPlist, AndroidConfig } = require('@expo/config-plugins');

/**
 * Allows plain-HTTP requests from release builds on both platforms.
 *
 * loversrock talks to a self-hosted backend over Tailscale, addressed by its
 * 100.x.x.x CGNAT IP. There is no hostname to put on a certificate, so the
 * connection is plain HTTP — but it rides inside Tailscale's WireGuard tunnel,
 * so it is not actually in the clear.
 *
 * Both platforms block that by default in a release build, and neither says so
 * in a way the app can see — the request just fails, indistinguishable from the
 * server being down:
 *
 *   Android  cleartext is denied from targetSdkVersion 28 up. Expo writes
 *            `usesCleartextTraffic="true"` into the *debug* manifest only, so
 *            debug builds work and release builds (what `eas build --profile
 *            preview` produces) do not.
 *   iOS      App Transport Security rejects http:// URLs. NSAllowsLocalNetworking
 *            is not enough: it covers 10/8, 172.16/12, 192.168/16 and .local,
 *            but not Tailscale's 100.64/10 range.
 *
 * If you ever put the backend behind a TLS-terminating reverse proxy with a
 * real certificate, drop this plugin from app.json.
 */
function withAndroidCleartext(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    application.$['android:usesCleartextTraffic'] = 'true';
    return cfg;
  });
}

function withIosAts(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSAppTransportSecurity = {
      ...(cfg.modResults.NSAppTransportSecurity || {}),
      NSAllowsArbitraryLoads: true,
      NSAllowsLocalNetworking: true,
    };
    return cfg;
  });
}

module.exports = function withCleartextTraffic(config) {
  config = withAndroidCleartext(config);
  config = withIosAts(config);
  return config;
};
