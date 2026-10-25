#!/bin/zsh
# Writes a Talkdesk API token to tests/.tok (mode 600).
# Usage: ./get_token.sh [env file with TALKDESK_CLIENT_ID / TALKDESK_CLIENT_SECRET]
# Env: TD_TENANT (default partner-team1)
cd "${0:A:h}"
ENV_FILE=${1:-../../../.env.local}
[[ -f $ENV_FILE ]] && { set -a; . "$ENV_FILE"; set +a; }
: ${TALKDESK_CLIENT_ID:?set TALKDESK_CLIENT_ID} ${TALKDESK_CLIENT_SECRET:?set TALKDESK_CLIENT_SECRET}
umask 077
curl -s -u "$TALKDESK_CLIENT_ID:$TALKDESK_CLIENT_SECRET" -d grant_type=client_credentials \
  "https://${TD_TENANT:-partner-team1}.talkdeskid.com/oauth/token" \
  | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["access_token"])' > .tok && echo "token saved to tests/.tok"
