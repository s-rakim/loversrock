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
  check('it is drawn as her ~·~ heart ~·~ him', /@\+id\/distance_left_art/.test(layout) && /@\+id\/distance_right_art/.test(layout)
    && /widget_kiss_icon/.test(layout) && /@drawable\/widget_distance_wiggle/.test(layout));

  // Head to toe: the separate full-body pictures, the SAME files the app
  // bundles, scaled to fit rather than cropped to a face.
  const nodpi = path.join(android, 'res', 'drawable-nodpi');
  for (const [art, file] of [['a', 'me-neutral.jpg'], ['b', 'partner-neutral.jpg']]) {
    const copy = path.join(nodpi, `widget_mascot_${art}.jpg`);
    const original = path.join(root, 'assets', 'mascot', file);
    check(`  widget_mascot_${art}.jpg is byte-for-byte the app's ${file}`,
      fs.existsSync(copy) && fs.readFileSync(copy).equals(fs.readFileSync(original)));
  }
  const arts = layout.match(/<ImageView[^>]*distance_(left|right)_art[^>]*>/g) || [];
  // Her on the left, him on the right — on both phones, whoever is holding it.
  check('  her picture (b) stands on the left and his (a) on the right',
    /distance_left_art"[^>]*src="@drawable\/widget_mascot_b"/s.test(layout)
    && /distance_right_art"[^>]*src="@drawable\/widget_mascot_a"/s.test(layout)
    && /LEFT_ART = "b"/.test(kotlin) && !/setImageViewResource\(R\.id\.distance_/.test(kotlin));
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
  check('  iOS stands them the same way round',
    /DistanceMascot\(art: "b", mood: meOnLeft \? s\.myMoodEmoji/.test(swift)
    && /DistanceMascot\(art: "a", mood: meOnLeft \? s\.partnerMoodEmoji/.test(swift));
  // iOS: the same fields, the same two pictures, the same dots.
  const data = fs.readFileSync(path.join(ios, 'WidgetData.swift'), 'utf8');
  check('iOS decodes the same six fields',
    ['myArt', 'partnerArt', 'myMoodEmoji', 'partnerMoodEmoji', 'mySymptomEmoji', 'partnerSymptomEmoji']
      .every((f) => new RegExp(`let ${f}: `).test(data)));
  const images = iosPlugin.default?.WIDGET_IMAGES ?? iosPlugin.WIDGET_IMAGES;
  check('  and the plugin bundles the pictures it loads by name',
    Object.keys(images).every((name) => swift.includes(`"${name}"`))
    && Object.values(images).every((from) => fs.existsSync(path.join(root, from))), images);
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
    /<layer-list/.test(bg) && /widget_glass_top/.test(bg) && /widget_glass_sheen/.test(bg) && /widget_glass_rim/.test(bg));
  const strings = fs.readFileSync(path.join(android, 'res', 'values', 'widget_colors.xml'), 'utf8');
  const alpha = (name) => parseInt(strings.match(new RegExp(`<color name="${name}">#([0-9A-F]{2})`, 'i'))?.[1] ?? 'FF', 16);
  // See-through enough for the wallpaper to tint it, solid enough to read
  // text on with no blur behind it.
  const [top, bottom] = [alpha('widget_glass_top'), alpha('widget_glass_bottom')];
  check('  and it is translucent, not a solid card', top <= 0xC8 && bottom <= 0xC8 && top >= 0x99 && bottom >= 0x99, { top, bottom });
  const layouts = fs.readdirSync(path.join(android, 'res', 'layout'));
  const rootTag = (xml) => xml.replace(/<\?xml[^>]*>/, '').replace(/<!--[\s\S]*?-->/g, '').match(/<[A-Za-z][^>]*>/)[0];
  for (const file of layouts) {
    const root = rootTag(fs.readFileSync(path.join(android, 'res', 'layout', file), 'utf8'));
    if (file === 'widget_photo.xml') {
      // The locket is the exception: the photo they sent, edge to edge.
      check('  the locket is NOT glass — the photo fills it, rounded',
        /@drawable\/widget_photo_background/.test(root) && /clipToOutline="true"/.test(root));
    } else {
      check(`  ${file} sits on the glass`, /android:background="@drawable\/widget_background"/.test(root), root);
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

console.log(`\nWIDGET WIRING RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
