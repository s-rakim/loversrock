const fs = require('fs');
const path = require('path');
const { withDangerousMod, withXcodeProject, withEntitlementsPlist } = require('@expo/config-plugins');

const TARGET_NAME = 'LoversRockWidgets';
const APP_GROUP = 'group.com.loversrock.app';
const DEPLOYMENT_TARGET = '16.0'; // accessory (lock screen) families are iOS 16+

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>loversrock</string>
  <key>CFBundleName</key>
  <string>${TARGET_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundlePackageType</key>
  <string>XPC!</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>
`;

const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP}</string>
  </array>
</dict>
</plist>
`;

/** Copies the widget Swift sources and writes the extension's plist/entitlements. */
function withWidgetSources(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const iosRoot = cfg.modRequest.platformProjectRoot;
      const source = path.join(projectRoot, 'widgets', 'ios');
      const targetDir = path.join(iosRoot, TARGET_NAME);

      fs.mkdirSync(targetDir, { recursive: true });

      // Widget extension sources (the RN bridge belongs to the app target, not here).
      for (const file of ['WidgetData.swift', 'LoversRockWidgets.swift', 'MomentWidgets.swift']) {
        fs.copyFileSync(path.join(source, file), path.join(targetDir, file));
      }
      fs.writeFileSync(path.join(targetDir, 'Info.plist'), INFO_PLIST);
      fs.writeFileSync(path.join(targetDir, `${TARGET_NAME}.entitlements`), ENTITLEMENTS);

      // The RCT bridge module compiles into the main app target.
      const appDir = path.join(iosRoot, cfg.modRequest.projectName);
      for (const file of ['WidgetBridge.swift', 'WidgetBridge.m']) {
        fs.copyFileSync(path.join(source, file), path.join(appDir, file));
      }

      return cfg;
    },
  ]);
}

/** The main app needs the same App Group to write into the shared container. */
function withAppGroup(config) {
  return withEntitlementsPlist(config, (cfg) => {
    const key = 'com.apple.security.application-groups';
    const groups = cfg.modResults[key] || [];
    if (!groups.includes(APP_GROUP)) groups.push(APP_GROUP);
    cfg.modResults[key] = groups;
    return cfg;
  });
}

/** Creates the WidgetKit extension target in the Xcode project. */
function withWidgetTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;

    if (project.pbxTargetByName(TARGET_NAME)) return cfg;

    const bundleId = `${cfg.ios.bundleIdentifier}.widgets`;

    const target = project.addTarget(TARGET_NAME, 'app_extension', TARGET_NAME, bundleId);

    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

    const group = project.addPbxGroup(
      ['WidgetData.swift', 'LoversRockWidgets.swift', 'MomentWidgets.swift', 'Info.plist', `${TARGET_NAME}.entitlements`],
      TARGET_NAME,
      TARGET_NAME
    );

    // Hang the new group off the project root so it shows in the navigator.
    const groups = project.hash.project.objects.PBXGroup;
    Object.keys(groups).forEach((key) => {
      if (groups[key].name === undefined && groups[key].path === undefined && groups[key].children) {
        project.addToPbxGroup(group.uuid, key);
      }
    });

    project.addSourceFile('WidgetData.swift', { target: target.uuid }, group.uuid);
    project.addSourceFile('LoversRockWidgets.swift', { target: target.uuid }, group.uuid);
    project.addSourceFile('MomentWidgets.swift', { target: target.uuid }, group.uuid);

    // The bridge compiles into the app target. A group key is required here:
    // without one, xcode's addSourceFile falls through to addPluginFile, which
    // looks for a "Plugins" group that Expo projects don't have and throws.
    const appTarget = project.getFirstTarget().uuid;
    const appGroupKey =
      project.findPBXGroupKey({ name: cfg.modRequest.projectName }) ||
      project.findPBXGroupKey({ path: cfg.modRequest.projectName });

    if (appGroupKey) {
      project.addSourceFile(`${cfg.modRequest.projectName}/WidgetBridge.swift`, { target: appTarget }, appGroupKey);
      project.addSourceFile(`${cfg.modRequest.projectName}/WidgetBridge.m`, { target: appTarget }, appGroupKey);
    }

    // Best-effort build ordering. The embed phase (dstSubfolderSpec 13) is what
    // actually ships the .appex and is verified present; this dependency is
    // belt-and-braces and silently no-ops on some `xcode` versions, so confirm
    // it in Xcode under the app target's Build Phases > Dependencies.
    try {
      project.addTargetDependency(appTarget, [target.uuid]);
    } catch (e) {
      console.warn(`[withIosWidgets] could not add target dependency: ${e.message}`);
    }

    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const buildSettings = configurations[key].buildSettings;
      if (!buildSettings || buildSettings.PRODUCT_NAME !== `"${TARGET_NAME}"`) continue;

      buildSettings.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
      buildSettings.INFOPLIST_FILE = `"${TARGET_NAME}/Info.plist"`;
      buildSettings.CODE_SIGN_ENTITLEMENTS = `"${TARGET_NAME}/${TARGET_NAME}.entitlements"`;
      buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${bundleId}"`;
      buildSettings.SWIFT_VERSION = '5.0';
      buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
      buildSettings.SKIP_INSTALL = 'YES';
    }

    return cfg;
  });
}

module.exports = function withIosWidgets(config) {
  config = withWidgetSources(config);
  config = withAppGroup(config);
  config = withWidgetTarget(config);
  return config;
};
