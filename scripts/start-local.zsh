#!/bin/zsh
# Runs only when the user deliberately launches it; never writes a credential file.
set -euo pipefail
cd "${0:A:h:h}"
if [[ ! -f server-dist/api.mjs ]]; then
  print -u2 'Run npm run build first.'
  exit 1
fi
if [[ "${1:-}" == '--approved-live' ]]; then
  if [[ "${WARDROBE_LIVE_MODE:-}" != approved || -z "${WARDROBE_APPROVED_IMAGE_SHA256:-}" || -z "${WARDROBE_APPROVAL_EXPIRES_AT:-}" || -z "${WARDROBE_MAX_CALLS:-}" ]]; then
    print -u2 'Live launch refused. Explicit approved photo hashes, expiry and call limit are required first.'
    exit 1
  fi
  print 'Approved local mode requested. The server will validate scope and expiry. This is not a dollar billing cap.'
elif [[ $# == 0 ]]; then
  export WARDROBE_LIVE_MODE=disabled
  print 'Live Meta requests stay disabled. The key only lives in this server process.'
else
  print -u2 'Usage: npm run dev:key -- [--approved-live]'
  exit 1
fi
if [[ ! -t 0 ]]; then
  print -u2 'Open Terminal and run this launcher yourself for hidden key entry.'
  exit 1
fi
read -r -s 'MODEL_API_KEY?Meta API key (hidden; never stored in a file): '
print
if [[ -z "$MODEL_API_KEY" ]]; then
  print -u2 'No key entered. Nothing was started.'
  exit 1
fi
export MODEL_API_KEY
exec node server.mjs
