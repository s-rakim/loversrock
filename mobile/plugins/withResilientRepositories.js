const { withProjectBuildGradle } = require('@expo/config-plugins');

/**
 * Keeps one slow Maven server from failing the whole Android build.
 *
 * React Native's Gradle plugin adds two extra repositories to every module,
 * after Google and Maven Central: jitpack.io and Sonatype's snapshots. Gradle
 * asks every repository about any dependency with a version range, and
 * react-native-webrtc depends on `org.jitsi:webrtc:124.+`. So jitpack gets
 * asked for jitsi's versions, and when jitpack times out Gradle switches it
 * off for the rest of the build and fails everything it could not rule out.
 * expo-camera's cameraview is one such casualty, even though it has nothing
 * to do with jitpack:
 *
 *   Could not resolve com.google.android:cameraview:1.0.0
 *     > Repository maven4 is disabled due to earlier error below:
 *       > Failed to list versions for org.jitsi:webrtc.
 *         > Could not GET 'https://www.jitpack.io/org/jitsi/webrtc/maven-metadata.xml'
 *           > Read timed out
 *
 * So each is only ever asked for what it actually hosts: jitpack for
 * `com.github.*` (its coordinates are com.github.<user>), Sonatype's
 * snapshots for React Native's own nightlies. Everything else goes to Google
 * and Maven Central alone. `configureEach` also reaches the repositories the
 * React Native plugin adds after this runs.
 */
const MARKER = '// loversrock: withResilientRepositories';

const SNIPPET = `
${MARKER}
allprojects {
    repositories.withType(MavenArtifactRepository).configureEach { repo ->
        def url = repo.url.toString()
        if (url.contains('jitpack.io')) {
            repo.content { includeGroupByRegex 'com\\\\.github\\\\..*' }
        } else if (url.contains('oss.sonatype.org')) {
            repo.content { includeGroupByRegex 'com\\\\.facebook\\\\..*' }
        }
    }
}
`;

function withResilientRepositories(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withResilientRepositories: expected a Groovy android/build.gradle');
    }
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += SNIPPET;
    }
    return cfg;
  });
}

module.exports = withResilientRepositories;
module.exports.SNIPPET = SNIPPET;
