// The wiring between a widget that exists and a widget that ships.
//
// Every failure this guards against looks the same from a desk: the code is
// written, committed, reviewed, and the widget simply is not in the gallery
// on the phone, because one of four lists did not get the new name.
//
//   * Android: the Kotlin class exists but no <receiver> in the manifest
//   * Android: the receiver points at an @xml/..._info that does not exist
//   * Android: the info xml points at a @layout/... or @string/... that does not
//   * iOS: the Swift file is not copied into the extension target
//   * iOS: the Widget struct is not in the @main WidgetBundle
//
// None of those is a compile error on either platform.
import fs from 'node:fs';
import path from 'node:path';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${d ?? ''}`); } };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const android = path.join(root, 'widgets', 'android');
const ios = path.join(root, 'widgets', 'ios');

console.log('=== ANDROID: EVERY PROVIDER IS REGISTERED ===');
const kotlin = fs.readdirSync(android).filter((f) => f.endsWith('.kt'))
  .map((f) => read('widgets', 'android', f)).join('\n');
// Abstract base classes are not receivers and must not be registered.
const providers = [...kotlin.matchAll(/^class (\w+WidgetProvider)\s*:/gm)].map((m) => m[1]);
const plugin = read('plugins', 'withAndroidWidgets.js');

check(`found ${providers.length} concrete providers`, providers.length >= 8, providers.join(', '));
for (const name of providers) {
  check(`${name} has a manifest receiver`, plugin.includes(`.widgets.${name}`), 'not in withAndroidWidgets.js');
}
check('the abstract base is NOT registered as a receiver',
  !plugin.includes('.widgets.GlanceWidgetProvider'), 'an abstract receiver crashes on broadcast');

console.log('\n=== ANDROID: EVERY RESOURCE A RECEIVER NAMES ACTUALLY EXISTS ===');
const infos = [...plugin.matchAll(/@xml\/(\w+)/g)].map((m) => m[1]);
check(`${infos.length} receivers name an info xml`, infos.length === providers.length, infos.join(', '));
for (const info of infos) {
  const file = path.join(android, 'res', 'xml', `${info}.xml`);
  check(`res/xml/${info}.xml exists`, fs.existsSync(file));
  if (!fs.existsSync(file)) continue;
  const xml = fs.readFileSync(file, 'utf8');
  for (const [, layout] of xml.matchAll(/@layout\/(\w+)/g)) {
    check(`  ${info} → res/layout/${layout}.xml exists`,
      fs.existsSync(path.join(android, 'res', 'layout', `${layout}.xml`)));
  }
  for (const [, str] of xml.matchAll(/@string\/(\w+)/g)) {
    check(`  ${info} → @string/${str} is declared`,
      read('widgets', 'android', 'res', 'values', 'widget_colors.xml').includes(`name="${str}"`));
  }
}

console.log('\n=== ANDROID: EVERY VIEW ID THE KOTLIN TOUCHES IS IN A LAYOUT ===');
// The typecheck catches a missing R.id symbol, but not a layout that simply
// does not contain the id the provider writes to — that is a silent no-op.
const layouts = Object.fromEntries(fs.readdirSync(path.join(android, 'res', 'layout'))
  .map((f) => [f.replace('.xml', ''), fs.readFileSync(path.join(android, 'res', 'layout', f), 'utf8')]));
const providerSources = fs.readdirSync(android).filter((f) => f.endsWith('.kt'))
  .map((f) => [f, read('widgets', 'android', f)]);

let idChecks = 0; const idProblems = [];
for (const [file, src] of providerSources) {
  for (const m of src.matchAll(/override val layoutId = R\.layout\.(\w+)/g)) {
    const layout = layouts[m[1]];
    if (!layout) { idProblems.push(`${file}: no layout ${m[1]}`); continue; }
    // The ids used by this class AND by the shared base it inherits from.
    const cls = src.slice(m.index);
    const body = cls.slice(0, cls.indexOf('\nclass ') === -1 ? cls.length : cls.indexOf('\nclass '));
    const base = read('widgets', 'android', 'GlanceWidgetProvider.kt');
    for (const id of new Set([...`${body}\n${base}`.matchAll(/R\.id\.(\w+)/g)].map((x) => x[1]))) {
      idChecks++;
      if (!layout.includes(`@+id/${id}`)) idProblems.push(`${m[1]} has no @+id/${id} (used by ${file})`);
    }
  }
}
check(`${idChecks} id references all resolve in their own layout`, idProblems.length === 0, idProblems.join(' | '));

console.log('\n=== IOS: EVERY WIDGET IS IN THE BUNDLE AND IN THE TARGET ===');
const iosPlugin = await import(path.join(root, 'plugins', 'withIosWidgets.js'));
const shipped = iosPlugin.default?.extensionSources?.(ios) ?? iosPlugin.extensionSources(ios);
const swiftFiles = fs.readdirSync(ios).filter((f) => f.endsWith('.swift'));
for (const file of swiftFiles) {
  const isApp = (iosPlugin.default?.APP_TARGET_SOURCES ?? iosPlugin.APP_TARGET_SOURCES).has(file);
  check(`${file} goes to the ${isApp ? 'app' : 'extension'} target`, shipped.includes(file) !== isApp, shipped.join(', '));
}
// The bridge imports React and would not compile inside an extension.
check('WidgetBridge is kept out of the extension', !shipped.includes('WidgetBridge.swift'));

const swift = shipped.map((f) => fs.readFileSync(path.join(ios, f), 'utf8')).join('\n');
const widgets = [...swift.matchAll(/^struct (\w+Widget): Widget \{/gm)].map((m) => m[1]);
const bundle = swift.slice(swift.indexOf('struct LoversRockWidgetBundle'));
check(`found ${widgets.length} Widget structs`, widgets.length >= 9, widgets.join(', '));
for (const name of widgets) {
  check(`${name} is in the @main bundle`, bundle.includes(`${name}()`), 'declared but never shipped');
}

// A duplicate `kind` means two widgets sharing one timeline, and reloading
// one reloads the other's data into it.
const kinds = [...swift.matchAll(/kind: "([^"]+)"/g)].map((m) => m[1]);
check(`all ${kinds.length} widget kinds are unique`, new Set(kinds).size === kinds.length, kinds.join(', '));

console.log('\n=== A SEALED NOTE IS NEVER PRINTED ON A HOME SCREEN ===');
// Both platforms render the secret-message widget, and both must announce
// rather than reveal. The server does not send the body at all, so this is
// the second of two locks rather than the only one.
check('iOS announces a sealed note without a body',
  /sealedNoteWaiting == true/.test(swift) && /A sealed note is waiting/.test(swift));
check('Android does the same', /sealedNoteWaiting == true/.test(kotlin) && /A sealed note is waiting/.test(kotlin));

console.log('\n=== THE WIDGET PICKER SHOWS EACH WIDGET, NOT A ROBOT ===');
// Every widget declared only previewLayout — Android 12+, and ignored even
// there by some launchers (ColorOS). With no previewImage to fall back on, the
// picker drew the stock Android robot for all nine and titled every one
// "loversrock", so nobody could tell a kiss button from a calendar.
{
  const res = path.join(android, 'res');
  const strings = fs.readFileSync(path.join(res, 'values', 'widget_colors.xml'), 'utf8');
  const receivers = [...plugin.matchAll(/\{ name: '\.widgets\.(\w+)', info: '@xml\/(\w+)', label: '@string\/(\w+)' \}/g)];
  check(`all ${providers.length} providers are registered with a name`, receivers.length === providers.length,
    `${receivers.length} labelled receivers for ${providers.length} providers`);

  for (const [, cls, info, label] of receivers) {
    const xml = fs.readFileSync(path.join(res, 'xml', `${info}.xml`), 'utf8');
    const preview = xml.match(/android:previewImage="@drawable\/(\w+)"/)?.[1];
    const file = preview && ['drawable-nodpi', 'drawable'].map((d) => path.join(res, d, `${preview}.png`))
      .find((f) => fs.existsSync(f));
    check(`  ${cls} has a preview image that exists`, Boolean(file), preview || 'no previewImage');
    // A PNG, not a stub: under a kilobyte would be an empty or failed render.
    check(`  and it is a real picture`, file && fs.statSync(file).size > 1024, file && fs.statSync(file).size);
    check(`  and a name the picker shows`, new RegExp(`<string name="${label}">[^<]+</string>`).test(strings), label);
  }

  // The previews are drawn in the widgets' own palette; a colour changed in
  // one place and not the other would make the picker lie about the widget.
  const gen = fs.readFileSync(path.join(android, 'tools', 'generate_previews.py'), 'utf8');
  const hex = (name) => strings.match(new RegExp(`<color name="${name}">#FF([0-9A-F]{6})</color>`, 'i'))?.[1];
  const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
  for (const [py, name] of [['SURFACE', 'widget_surface'], ['BORDER', 'widget_border'],
    ['TEXT', 'widget_text'], ['MUTED', 'widget_text_muted'], ['ACCENT', 'widget_accent']]) {
    const want = hex(name) && rgb(hex(name));
    check(`  preview ${py} matches ${name}`, gen.includes(`${py} = (${want})`), want);
  }
}

console.log('\n=== THE DISTANCE WIDGET ===');
{
  const layout = fs.readFileSync(path.join(android, 'res', 'layout', 'widget_distance.xml'), 'utf8');
  // The base class paints "set this up" and "pair first" into these slots
  // before the widget's own paint() runs; without them the update crashes.
  for (const id of ['widget_root', 'glance_label', 'glance_value', 'glance_caption', 'widget_refresh']) {
    check(`  the layout carries @+id/${id} for the base class`, layout.includes(`@+id/${id}`));
  }
  check('it is drawn as you ~·~ heart ~·~ them', /@\+id\/distance_left_art/.test(layout) && /@\+id\/distance_right_art/.test(layout)
    && /widget_kiss_icon/.test(layout) && /@drawable\/widget_distance_wiggle/.test(layout));

  // By default the original pictures, the SAME files the app ships; an
  // upload replaces only its owner's.
  const nodpi = path.join(android, 'res', 'drawable-nodpi');
  for (const [art, file] of [['a', 'me-neutral.jpg'], ['b', 'partner-neutral.jpg']]) {
    const copy = path.join(nodpi, `widget_mascot_${art}.jpg`);
    check(`  widget_mascot_${art}.jpg is byte-for-byte the app's ${file}`,
      fs.existsSync(copy) && fs.readFileSync(copy).equals(fs.readFileSync(path.join(root, 'assets', 'mascot', file))));
  }
  const arts = layout.match(/<ImageView[^>]*distance_(left|right)_art[^>]*>/g) || [];
  check('  her original picture (b) starts on the left, his (a) on the right',
    /distance_left_art"[^>]*src="@drawable\/widget_mascot_b"/s.test(layout)
    && /distance_right_art"[^>]*src="@drawable\/widget_mascot_a"/s.test(layout) && /LEFT_ART = "b"/.test(kotlin));
  const distanceSrc = kotlin.slice(kotlin.indexOf('class DistanceWidgetProvider'));
  check('  and paint() puts in the uploads, falling back to the originals, each on its own side',
    /override fun fetchExtra[\s\S]*fetchMascot\(context, "me"\)[\s\S]*fetchMascot\(context, "partner"\)/.test(distanceSrc)
    && /distance_left_art,\s*WidgetRepository\.mascot\(context, if \(meOnLeft\) "me" else "partner"\), R\.drawable\.widget_mascot_b\)/.test(distanceSrc)
    && /distance_right_art,\s*WidgetRepository\.mascot\(context, if \(meOnLeft\) "partner" else "me"\), R\.drawable\.widget_mascot_a\)/.test(distanceSrc));
  const repoKt = fs.readFileSync(path.join(android, 'WidgetRepository.kt'), 'utf8');
  check('  downloading the small copy, only when it changed, kept small for RemoteViews',
    /\/widget\/mascot\/\$who/.test(repoKt) && /If-None-Match/.test(repoKt) && /404 ->[\s\S]*file\.delete\(\)/.test(repoKt)
    && /MASCOT_MAX_PX = (\d+)/.test(repoKt) && Number(repoKt.match(/MASCOT_MAX_PX = (\d+)/)[1]) <= 256);
  check('  both pictures are scaled to fit whole, never cropped', arts.length === 2
    && arts.every((tag) => /scaleType="fitCenter"/.test(tag)), arts.length);
  const info = fs.readFileSync(path.join(android, 'res', 'xml', 'widget_distance_info.xml'), 'utf8');
  check('  and the widget is two rows tall so a whole figure has room', /targetCellHeight="2"/.test(info));

  // The wiggle: dots, generated, and never stretched out of round.
  const wiggle = fs.readFileSync(path.join(android, 'res', 'drawable', 'widget_distance_wiggle.xml'), 'utf8');
  check('the line is the generated wiggle of dots', /GENERATED by widgets\/android\/tools\/generate_wiggle\.py/.test(wiggle)
    && (wiggle.match(/a1\.6,1\.6/g) || []).length > 40);
  const wiggleTag = layout.match(/<ImageView[^>]*widget_distance_wiggle[^>]*>/)?.[0] || '';
  check('  shown cropped, not stretched, so the dots stay round', /scaleType="centerCrop"/.test(wiggleTag)
    && /layout_height="24dp"/.test(wiggleTag) && /android:height="24dp"/.test(wiggle));

  // Mood and symptoms: slots in the layout, painted from the summary.
  for (const id of ['distance_left_mood', 'distance_right_mood', 'distance_left_symptoms', 'distance_right_symptoms']) {
    check(`  the layout has @+id/${id}, hidden until there is something in it`,
      new RegExp(`@\\+id/${id}"[^>]*visibility="gone"`, 's').test(layout));
  }
  const distanceKt = kotlin.slice(kotlin.indexOf('class DistanceWidgetProvider'));
  check('  and paint() fills all four, each under whoever is standing in that slot',
    ['myMoodEmoji', 'partnerMoodEmoji', 'mySymptomEmoji', 'partnerSymptomEmoji'].every((f) => distanceKt.includes(f))
    && /val meOnLeft = \(data\?\.myArt \?: "a"\) == LEFT_ART/.test(distanceKt)
    && /distance_left_mood, if \(meOnLeft\) myMood else theirMood/.test(distanceKt)
    && /distance_right_mood, if \(meOnLeft\) theirMood else myMood/.test(distanceKt));
  check('  iOS stands them the same way round, with the downloaded mascots',
    /DistanceMascot\(image: entry\.mascots\[meOnLeft \? "me" : "partner"\],\s*original: "widget_mascot_b\.jpg",\s*mood: meOnLeft \? s\.myMoodEmoji/.test(swift)
    && /DistanceMascot\(image: entry\.mascots\[meOnLeft \? "partner" : "me"\],\s*original: "widget_mascot_a\.jpg",\s*mood: meOnLeft \? s\.partnerMoodEmoji/.test(swift)
    && /GlanceProvider\(wantsMascots: true\)/.test(swift));
  // iOS: the same fields, the same two pictures, the same dots.
  const data = fs.readFileSync(path.join(ios, 'WidgetData.swift'), 'utf8');
  check('iOS decodes the same six fields',
    ['myArt', 'partnerArt', 'myMoodEmoji', 'partnerMoodEmoji', 'mySymptomEmoji', 'partnerSymptomEmoji']
      .every((f) => new RegExp(`let ${f}: `).test(data)));
  const pluginSrc = fs.readFileSync(path.join(root, 'plugins', 'withIosWidgets.js'), 'utf8');
  const images = iosPlugin.default?.WIDGET_IMAGES ?? iosPlugin.WIDGET_IMAGES;
  check('  and iOS bundles the originals it falls back to, and downloads the uploads',
    Object.keys(images).every((name) => swift.includes(`"${name}"`))
    && Object.values(images).every((from) => fs.existsSync(path.join(root, from)))
    && /\/widget\/mascot\//.test(data) && pluginSrc.length > 0, images);
  check('  drawn as round dots on a sine, not a straight dash',
    /struct DistanceWiggle: Shape/.test(swift) && /lineCap: \.round, dash: \[0,/.test(swift));
  const repo = fs.readFileSync(path.join(android, 'WidgetRepository.kt'), 'utf8');
  check('  from the fields the summary really sends',
    ['myArt', 'partnerArt', 'myMoodEmoji', 'partnerMoodEmoji', 'mySymptomEmoji', 'partnerSymptomEmoji']
      .every((f) => repo.includes(`"${f}"`)));
  // RemoteViews cannot inflate a plain View at all, only a short allowlist.
  check('and uses no view class RemoteViews refuses', !/<View\b/.test(layout));
  check('its caption says what to do when there is no number',
    /Turn on location sharing/.test(kotlin) && /Waiting for a location/.test(kotlin));
  check('iOS has it too, on the lock screen as well as the home screen',
    /struct DistanceWidget: Widget/.test(swift) && /DistanceWidget\(\)/.test(bundle)
    && /\.accessoryRectangular/.test(swift.slice(swift.indexOf('struct DistanceWidget'))));
  // Nothing called GlanceWidgetProvider.refreshAll, so these only updated on
  // the 30-minute timer — a distance widget that ignores the location the app
  // just sent shows the wrong number with confidence.
  const bridge = fs.readFileSync(path.join(android, 'WidgetBridgeModule.kt'), 'utf8');
  check('the glance widgets refresh when the app pushes new data',
    /GlanceWidgetProvider\.refreshAll/.test(bridge) && /DistanceWidgetProvider::class\.java/.test(bridge));
}

console.log('\n=== EVERY WIDGET IS GREY LIQUID GLASS ===');
{
  const bg = fs.readFileSync(path.join(android, 'res', 'drawable', 'widget_background.xml'), 'utf8');
  check('the shared Android background is the glass layer-list',
    /<layer-list/.test(bg) && /GENERATED by widgets\/android\/tools\/generate_glass\.py/.test(bg)
    && /widget_glass_sheen/.test(bg) && /widget_glass_rim/.test(bg));
  // The translucency setting: one generated drawable per 5%, the same
  // range and default in the Android table, the app's slider and iOS.
  const drawables = path.join(android, 'res', 'drawable');
  const bodyAlpha = (xml) => xml.match(/startColor="#([0-9A-F]{2})E4E6EA"/)?.[1];
  const levels = fs.readdirSync(drawables).map((f) => f.match(/^widget_glass_(\d+)\.xml$/)?.[1]).filter(Boolean)
    .map(Number).sort((a, b) => a - b);
  const bridgeJs = fs.readFileSync(path.join(root, 'services', 'widgetBridge.js'), 'utf8');
  const [, jsMin, jsMax, jsStep, jsDefault] = bridgeJs
    .match(/WIDGET_OPACITY = \{ min: (\d+), max: (\d+), step: (\d+), default: (\d+) \}/).map(Number);
  const want = [];
  for (let v = jsMin; v <= jsMax; v += jsStep) want.push(v);
  check('there is a glass drawable for every stop on the Settings slider', JSON.stringify(levels) === JSON.stringify(want), { levels, want });
  const alphas = levels.map((l) => parseInt(bodyAlpha(fs.readFileSync(path.join(drawables, `widget_glass_${l}.xml`), 'utf8')), 16));
  check('  and each is more opaque than the one before', alphas.every((a, i) => i === 0 || a > alphas[i - 1]), alphas);
  check('  the layouts\' default glass is the default level',
    bodyAlpha(bg) === bodyAlpha(fs.readFileSync(path.join(drawables, `widget_glass_${jsDefault}.xml`), 'utf8')));
  const table = fs.readFileSync(path.join(android, 'GlassLevels.kt'), 'utf8');
  check('  the Kotlin table lists every level, with the same default',
    levels.every((l) => table.includes(`${l} to R.drawable.widget_glass_${l}`)) && table.includes(`GLASS_DEFAULT = ${jsDefault}`));
  check('  and iOS falls back to the same default', new RegExp(`stored \\?\\? ${jsDefault}\\)`).test(swift));
  // Applied wherever glass is drawn, and never on the locket.
  const read = (f) => fs.readFileSync(path.join(android, f), 'utf8');
  check('the chosen level is painted on the glance widgets and the summary',
    /GlassStyle\.apply\(context, views, layoutId, manager, widgetId\)/.test(read('GlanceWidgetProvider.kt'))
    && /GlassStyle\.apply\(context, views, R\.layout\.widget_summary, manager, widgetId\)/.test(read('SummaryWidgetProvider.kt')));
  check('  but not on the locket', !/GlassStyle/.test(read('PhotoWidgetProvider.kt')));
  check('  and the app can set it on both platforms',
    /fun setWidgetOpacity\(percent: Int, promise: Promise\)/.test(read('WidgetBridgeModule.kt'))
    && /RCT_EXTERN_METHOD\(setWidgetOpacity:/.test(fs.readFileSync(path.join(ios, 'WidgetBridge.m'), 'utf8'))
    && /func setWidgetOpacity\(/.test(fs.readFileSync(path.join(ios, 'WidgetBridge.swift'), 'utf8'))
    && /forKey: "glassOpacity"/.test(fs.readFileSync(path.join(ios, 'WidgetBridge.swift'), 'utf8')));
  check('  and a logout does not reset it (kept apart from the credentials)',
    /loversrock_widget_style/.test(read('GlassStyle.kt')) && !/glassOpacity/.test(
      fs.readFileSync(path.join(ios, 'WidgetBridge.swift'), 'utf8').slice(
        fs.readFileSync(path.join(ios, 'WidgetBridge.swift'), 'utf8').indexOf('func clearCredentials'),
        fs.readFileSync(path.join(ios, 'WidgetBridge.swift'), 'utf8').indexOf('func refresh'))));
  const layouts = fs.readdirSync(path.join(android, 'res', 'layout'));
  const rootTag = (xml) => xml.replace(/<\?xml[^>]*>/, '').replace(/<!--[\s\S]*?-->/g, '').match(/<[A-Za-z][^>]*>/)[0];
  for (const file of layouts) {
    const root = rootTag(fs.readFileSync(path.join(android, 'res', 'layout', file), 'utf8'));
    if (file === 'widget_photo.xml') {
      // The locket is the exception: the photo they sent, edge to edge.
      check('  the locket is NOT glass — the photo fills it, rounded',
        /@drawable\/widget_photo_background/.test(root) && /clipToOutline="true"/.test(root));
    } else {
      // The background is its own image under the content, so a look can
      // be painted into it; it starts as the glass.
      const xml = fs.readFileSync(path.join(android, 'res', 'layout', file), 'utf8');
      const firstChild = xml.slice(xml.indexOf(root) + root.length).replace(/<!--[\s\S]*?-->/g, '').match(/<[A-Za-z][^>]*>/)?.[0] || '';
      check(`  ${file} sits on the glass`, /@\+id\/widget_frame/.test(root)
        && /@\+id\/widget_bg/.test(firstChild) && /android:src="@drawable\/widget_background"/.test(firstChild)
        && /scaleType="fitXY"/.test(firstChild) && /@\+id\/widget_root/.test(xml), firstChild);
    }
  }
  const allSwift = fs.readdirSync(ios).filter((f) => f.endsWith('.swift')).map((f) => fs.readFileSync(path.join(ios, f), 'utf8')).join('\n');
  const configs = (allSwift.match(/StaticConfiguration\(kind:/g) || []).length;
  const glassed = (allSwift.match(/\(entry: entry\)\.lrGlassBackground\(\)/g) || []).length;
  check(`  and all ${configs - 1} iOS widgets but the locket use the same glass`, configs > 1 && glassed === configs - 1, { configs, glassed });
  check('  while the iOS locket fills with the photo itself',
    /containerBackground\(for: \.widget\) \{ PhotoWidgetFill\(entry: entry\) \}/.test(allSwift)
    && !/PhotoWidgetView\(entry: entry\)\.lrGlassBackground/.test(allSwift));
  check('  with no plain system background left over', !/containerBackground\(\.background/.test(allSwift));
}

console.log('\n=== THE LOCK SCREEN GLANCE IS AN ANDROID 16 LIVE UPDATE ===');
{
  // Samsung (One UI 8, Now Bar) and OPPO (ColorOS 16.1, lock-screen capsule)
  // keep their lock-screen widget pickers to their own apps, but both show
  // Android 16 Live Updates from any app. These are the rules Android checks
  // before it promotes a notification; break one and it silently stays plain.
  const notifier = fs.readFileSync(path.join(android, 'LockScreenNotifier.kt'), 'utf8');
  // The code alone: the comments explain the rules, and naming a rule is not breaking it.
  const notifierCode = notifier.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const pluginMod = await import(path.join(root, 'plugins', 'withAndroidWidgets.js'));
  const plugin = pluginMod.default ?? pluginMod;
  check('the promoted-notification permission is declared',
    (plugin.GLANCE_PERMISSIONS || []).includes('android.permission.POST_PROMOTED_NOTIFICATIONS')
    && plugin.GLANCE_PERMISSIONS.includes('android.permission.POST_NOTIFICATIONS'));
  // Raw keys, because this compiles against Android 14's SDK. The values are
  // Android 16's own (Notification.EXTRA_REQUEST_PROMOTED_ONGOING etc).
  check('  it asks to be promoted, with the exact Android 16 key',
    /EXTRA_REQUEST_PROMOTED_ONGOING = "android\.requestPromotedOngoing"/.test(notifier)
    && /putBoolean\(EXTRA_REQUEST_PROMOTED_ONGOING, true\)/.test(notifier) && /\.addExtras\(live\)/.test(notifier));
  check('  and gives the status bar chip its short text',
    /EXTRA_SHORT_CRITICAL_TEXT = "android\.shortCriticalText"/.test(notifier)
    && /putString\(EXTRA_SHORT_CRITICAL_TEXT, chipText\(data\)\)/.test(notifier));
  check('  ongoing, with a title and an allowed style',
    /\.setOngoing\(true\)/.test(notifier) && /\.setContentTitle\(title\)/.test(notifier)
    && /BigTextStyle/.test(notifier));
  check('  and none of what disqualifies one: custom views, colour, group summary',
    !/setCustomContentView|setCustomBigContentView|RemoteViews|setColorized\(true\)|setGroupSummary\(true\)/.test(notifierCode));
  check('  on a channel above IMPORTANCE_MIN', /IMPORTANCE_LOW/.test(notifierCode) && !/IMPORTANCE_MIN/.test(notifierCode));
  check('  kept current by every fresh summary, but only when switched on',
    /LockScreenNotifier\.onSummary\(context, it\)/.test(fs.readFileSync(path.join(android, 'WidgetRepository.kt'), 'utf8'))
    && /fun onSummary[\s\S]{0,120}if \(isEnabled\(context\)\) show\(context, data\)/.test(notifier));
  const bridgeKt = fs.readFileSync(path.join(android, 'WidgetBridgeModule.kt'), 'utf8');
  const refreshBody = bridgeKt.slice(bridgeKt.indexOf('fun refresh('), bridgeKt.indexOf('fun getLockScreenStatus'));
  check('  "Refresh widgets now" no longer brings back a glance that was turned off', !/LockScreenNotifier\.show/.test(refreshBody));
  check('  and Settings can ask whether it is live, and open the switch for it',
    /fun getLockScreenStatus\(promise: Promise\)/.test(bridgeKt) && /fun openLiveUpdateSettings\(promise: Promise\)/.test(bridgeKt)
    && /ACTION_PROMOTION_SETTINGS = "android\.settings\.APP_NOTIFICATION_PROMOTION_SETTINGS"/.test(notifier)
    && /canPostPromotedNotifications/.test(notifier));
}

console.log('\n=== WIDGET LOOKS: COLOURS, GRADIENTS, PATTERNS ===');
{
  const readA = (f) => fs.readFileSync(path.join(android, f), 'utf8');
  const lookJs = fs.readFileSync(path.join(root, 'components', 'widgetLook.js'), 'utf8');
  const painter = fs.readFileSync(path.join(android, 'WidgetPainter.kt'), 'utf8');
  const glassKt = fs.readFileSync(path.join(android, 'GlassStyle.kt'), 'utf8');
  const list = (name) => JSON.parse(lookJs.match(new RegExp(`export const ${name} = (\\[[^\\]]*\\])`))[1].replace(/'/g, '"'));
  const gradients = list('GRADIENTS'); const patterns = list('PATTERNS');
  // Every look the app offers is one Android and iOS know how to draw.
  check('Android draws every gradient and pattern the app offers',
    gradients.filter((g) => g !== 'linear' && g !== 'aurora').every((g) => painter.includes(`"${g}" ->`))
    && /"aurora"/.test(painter) && patterns.every((p) => painter.includes(`"${p}" ->`)), { gradients, patterns });
  check('  and so does iOS',
    gradients.filter((g) => g !== 'linear').every((g) => swift.includes(`"${g}"`))
    && patterns.filter((p) => p !== 'waves').every((p) => swift.includes(`case "${p}"`)) && /\/\/ waves/.test(swift));
  check('  with the same cell size, band and dot rules as the app',
    /0\.02 \+ 0\.04 \* look\.scale/.test(lookJs) && /0\.02f \+ 0\.04f \* look\.scale/.test(painter)
    && /0\.02 \+ 0\.04 \* look\.scale/.test(swift)
    && /0\.32f \* s/.test(painter) && /0\.32 \* s/.test(swift) && /0\.35f \* s/.test(painter) && /0\.35 \* s/.test(swift)
    && /AURORA_AT = 0\.45f/.test(painter) && /at: 0\.45/.test(lookJs));

  // The text colour: every view the generated lists name is in that layout,
  // because RemoteViews breaks the whole widget over a missing id.
  const inkKt = fs.readFileSync(path.join(android, 'GlassInk.kt'), 'utf8');
  check('the text-colour lists are generated from the layouts', /GENERATED by widgets\/android\/tools\/generate_ink\.py/.test(inkKt));
  for (const [, layout, body] of inkKt.matchAll(/R\.layout\.(\w+) to GlassInk\(([\s\S]*?)\n    \)/g)) {
    const xml = fs.readFileSync(path.join(android, 'res', 'layout', `${layout}.xml`), 'utf8');
    const named = [...body.matchAll(/R\.id\.(\w+)/g)].map((m) => m[1]);
    check(`  every id listed for ${layout} is in it`, named.every((id) => xml.includes(`@+id/${id}`)), named);
    const texts = [...xml.matchAll(/<TextView\b[^>]*android:id="@\+id\/(\w+)"[^>]*>/g)]
      .filter((m) => !/textColor="(?!@color\/widget_text)/.test(m[0])).map((m) => m[1]);
    check(`  and every plain-coloured text in ${layout} is listed`, texts.every((id) => named.includes(id)), texts);
  }
  check('dark looks turn the text light', /if \(look\.lightInk\)/.test(glassKt) && /setTextColor\(it, LIGHT_TEXT\)/.test(glassKt));
  check('  the painted background is small enough for RemoteViews', /MAX_PX = (\d+)/.test(glassKt) && Number(glassKt.match(/MAX_PX = (\d+)/)[1]) <= 400);
  check('  and a failure falls back to the glass, not a blank tile', /catch \(e: Throwable\)[\s\S]{0,160}drawableFor\(opacity\)/.test(glassKt));
  check('resizing a widget repaints it to its new shape', /override fun onAppWidgetOptionsChanged/.test(readA('GlanceWidgetProvider.kt')));
  check('the app can send a look on both platforms',
    /fun setWidgetLook\(json: String, promise: Promise\)/.test(readA('WidgetBridgeModule.kt'))
    && /RCT_EXTERN_METHOD\(setWidgetLook:/.test(fs.readFileSync(path.join(ios, 'WidgetBridge.m'), 'utf8'))
    && /forKey: "widgetLook"/.test(fs.readFileSync(path.join(ios, 'WidgetBridge.swift'), 'utf8'))
    && /forKey: "widgetLook"/.test(swift));
}

console.log(`\nWIDGET WIRING RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
