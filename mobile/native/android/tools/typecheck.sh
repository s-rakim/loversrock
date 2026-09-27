#!/usr/bin/env bash
# Type-checks the voice-note Kotlin without the Android SDK — the same method,
# and the same cached jars, as widgets/android/tools/typecheck.sh (read that
# for what this can and cannot prove). Run that one first on a fresh machine;
# it downloads the jars this reuses.
#
#   bash native/android/tools/typecheck.sh
set -euo pipefail

cd "$(dirname "$0")/../../.."          # -> mobile/
CACHE="${KT_TYPECHECK_CACHE:-${TMPDIR:-/tmp}/loversrock-ktcheck}"
LIBS="$CACHE/libs"; OUT="$CACHE/voice-out"
[ -s "$LIBS/android-all.jar" ] || bash widgets/android/tools/typecheck.sh >/dev/null
rm -rf "$OUT"; mkdir -p "$OUT"

CP="$LIBS/kotlin-compiler-embeddable.jar:$LIBS/kotlin-stdlib.jar:$LIBS/kotlin-reflect.jar:$LIBS/kotlin-script-runtime.jar:$LIBS/kotlin-daemon-embeddable.jar:$LIBS/trove4j.jar:$LIBS/annotations.jar"

java -cp "$CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -nowarn -jvm-target 17 \
  -cp "$LIBS/android-all.jar:$LIBS/kotlin-stdlib.jar:$LIBS/annotations.jar" \
  -d "$OUT" widgets/android/tools/stubs/react*.kt native/android/tools/stubs/*.kt native/android/voice/*.kt

count=$(find "$OUT/com/loversrock/app/voice" -name '*.class' 2>/dev/null | wc -l)
echo
if [ "$count" -gt 0 ]; then
  echo "VOICE KOTLIN TYPECHECK PASSED — $(ls native/android/voice/*.kt | wc -l) sources, $count classes emitted"
else
  echo "VOICE KOTLIN TYPECHECK FAILED"; exit 1
fi
