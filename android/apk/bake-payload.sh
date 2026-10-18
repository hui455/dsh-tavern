#!/usr/bin/env bash
# Runs only inside the disposable ARM64 image made from the verified DSHA assets.
set -euo pipefail
export HOME=/root DSH_HOME=/root/.dsh
export PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin
export DSH_TAVERN_ANDROID_STANDALONE=1
export DSH_TAVERN_RUNTIME_HOST=android
export npm_config_registry="${DSH_TAVERN_NPM_REGISTRY:-https://registry.npmmirror.com}"
export pnpm_config_registry="$npm_config_registry" pnpm_config_update_notifier=false
node -e 'if(process.arch!=="arm64" || process.platform!=="linux") process.exit(1)'
cd /root/.dsh/apps/dsh-tavern
# Standalone APK starts Tavern directly. Do not install DSHA's separate web
# Profile, whose Android bridge plugins are initialized by the native host.
PNPM_ROOT="$DSH_HOME/runtime/tavern-pnpm/11.25.0"
npm install --global --prefix "$PNPM_ROOT" pnpm@11.25.0
export PATH="$PNPM_ROOT/bin:$PATH"
[ "$(pnpm --version)" = 11.25.0 ]
pnpm config set package-import-method copy --location=user
pnpm config set side-effects-cache false --location=user
pnpm install --frozen-lockfile
node bin/dsh-tavern.mjs install --host android
node bin/runtime-dependencies.mjs /root/.dsh/apps/dsh-tavern
# Never distribute generated identity, sessions, credentials or installer logs.
mkdir -p /payload
tar -czf /payload/tavern-payload.tar.gz -C /root/.dsh \
  apps/dsh-tavern profiles/tavern runtime/tavern-pnpm
