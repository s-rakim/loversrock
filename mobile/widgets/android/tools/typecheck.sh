#!/usr/bin/env bash
# Type-checks the widget Kotlin without the Android SDK.
#
# The SDK is a multi-gigabyte install and is blocked by some network policies,
# so this assembles the smallest thing that can still catch a real compile
# error:
#
#   * Android framework classes — REAL, from Robolectric's android-all jar on
#     Maven Central (android.appwidget, android.widget.RemoteViews, org.json…)
#   * androidx.core notifications and the React Native bridge — hand-written
#     stubs, because both publish only to Maven repos this can't reach. Their
#     signatures mirror the documented API, so misuse is still an error.
#   * R — generated from the real files under widgets/android/res, so it
#     matches what aapt would emit.
#
# What it catches: syntax errors, type errors, bad Android framework calls,
# missing R symbols. What it does NOT: a mismatch between a stub and the real
# androidx/RN signature. Green here is strong evidence, not proof — only a
# Gradle build is proof.
#
#   bash widgets/android/tools/typecheck.sh
set -euo pipefail

cd "$(dirname "$0")/../../.."          # -> mobile/
CACHE="${KT_TYPECHECK_CACHE:-${TMPDIR:-/tmp}/loversrock-ktcheck}"
LIBS="$CACHE/libs"; STUBS="$CACHE/stubs"; OUT="$CACHE/out"
M=https://repo1.maven.org/maven2
KOTLIN=1.9.23                           # matches android/build.gradle kotlinVersion

mkdir -p "$LIBS" "$STUBS" "$OUT"
rm -rf "${OUT:?}/"* 2>/dev/null || true

fetch() { [ -s "$LIBS/$1" ] || { echo "  downloading $1"; curl -sSL -o "$LIBS/$1" "$2"; }; }
echo "Dependencies (cached in $CACHE):"
fetch kotlin-compiler-embeddable.jar "$M/org/jetbrains/kotlin/kotlin-compiler-embeddable/$KOTLIN/kotlin-compiler-embeddable-$KOTLIN.jar"
fetch kotlin-stdlib.jar              "$M/org/jetbrains/kotlin/kotlin-stdlib/$KOTLIN/kotlin-stdlib-$KOTLIN.jar"
fetch kotlin-reflect.jar             "$M/org/jetbrains/kotlin/kotlin-reflect/$KOTLIN/kotlin-reflect-$KOTLIN.jar"
fetch kotlin-script-runtime.jar      "$M/org/jetbrains/kotlin/kotlin-script-runtime/$KOTLIN/kotlin-script-runtime-$KOTLIN.jar"
fetch kotlin-daemon-embeddable.jar   "$M/org/jetbrains/kotlin/kotlin-daemon-embeddable/$KOTLIN/kotlin-daemon-embeddable-$KOTLIN.jar"
fetch trove4j.jar                    "$M/org/jetbrains/intellij/deps/trove4j/1.0.20200330/trove4j-1.0.20200330.jar"
fetch annotations.jar                "$M/org/jetbrains/annotations/24.1.0/annotations-24.1.0.jar"
fetch android-all.jar                "$M/org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar"

echo "Generating the R stub from widgets/android/res ..."
python3 widgets/android/tools/generate_r_stub.py "$STUBS/R.kt"
cp widgets/android/tools/stubs/*.kt "$STUBS/"

CP="$LIBS/kotlin-compiler-embeddable.jar:$LIBS/kotlin-stdlib.jar:$LIBS/kotlin-reflect.jar:$LIBS/kotlin-script-runtime.jar:$LIBS/kotlin-daemon-embeddable.jar:$LIBS/trove4j.jar:$LIBS/annotations.jar"

echo "Compiling ..."
java -cp "$CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -nowarn -jvm-target 17 \
  -cp "$LIBS/android-all.jar:$LIBS/kotlin-stdlib.jar:$LIBS/annotations.jar" \
  -d "$OUT" "$STUBS"/*.kt widgets/android/*.kt

count=$(find "$OUT/com/loversrock/app/widgets" -name '*.class' 2>/dev/null | wc -l)
sources=$(ls widgets/android/*.kt | wc -l)
echo
if [ "$count" -gt 0 ]; then
  echo "KOTLIN TYPECHECK PASSED — $sources sources, $count classes emitted"
else
  echo "KOTLIN TYPECHECK FAILED — no classes emitted"; exit 1
fi
