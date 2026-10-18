#!/usr/bin/env bash
set -euo pipefail
export HOME="${HOME:-/root}" DSH_HOME="${DSH_HOME:-/root/.dsh}"
export DSH_TAVERN_RUNTIME_HOST=android DSH_TAVERN_ANDROID_STANDALONE=1
export pnpm_config_update_notifier=false
mkdir -p "$DSH_HOME"
stage=$(mktemp -d "$DSH_HOME/.apk-install.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
tar -xzf "${TAVERN_APK_PAYLOAD:-/root/tavern-payload.tar.gz}" -C "$stage"
# Atomic directory promotion makes interruption retryable. Existing installations
# (including newer in-app updates) and all user data remain untouched.
for entry in apps/dsh-tavern profiles/tavern runtime/tavern-pnpm; do
  if [ ! -e "$DSH_HOME/$entry" ] && [ ! -L "$DSH_HOME/$entry" ]; then
    mkdir -p "$(dirname "$DSH_HOME/$entry")"
    mv "$stage/$entry" "$DSH_HOME/$entry"
  fi
done
export PATH="$DSH_HOME/runtime/tavern-pnpm/11.25.0/bin:$PATH"
node "$DSH_HOME/apps/dsh-tavern/bin/runtime-dependencies.mjs" "$DSH_HOME/apps/dsh-tavern"
node --input-type=module -e "import { ensureSidebarDefaults } from '$DSH_HOME/apps/dsh-tavern/bin/launcher-settings.mjs'; ensureSidebarDefaults()"
node --expose-internals "$(command -v dsh)" --profile tavern --dump-config >/dev/null
echo '酒馆本地初始化完成。'
