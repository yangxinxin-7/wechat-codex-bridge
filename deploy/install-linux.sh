#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${CODEXBRIDGE_STATE_DIR:-$HOME/.codexbridge}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/codexbridge"
ENV_FILE="${CONFIG_DIR}/weixin.service.env"

[[ "$(uname -s)" == Linux ]] || { echo '请在 Linux 服务器运行。' >&2; exit 1; }
for tool in node npm python3 systemctl codex ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || { echo "缺少 $tool，请先按 deploy/LINUX.md 安装。" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)' || {
  echo '需要 Node.js 24 或更高版本。' >&2; exit 1;
}
codex login status >/dev/null 2>&1 || { echo '请先运行 codex login --device-auth。' >&2; exit 1; }
[[ -d "${ROOT_DIR}/node_modules/tsx" ]] || { echo '请先运行 npm ci --ignore-scripts。' >&2; exit 1; }

if [[ ! -f "$ENV_FILE" ]]; then
  mkdir -p "$CONFIG_DIR" "${ROOT_DIR}/workspace"
  node --input-type=module - "$STATE_DIR" "$ENV_FILE" "$ROOT_DIR" "$(command -v codex)" "$(command -v ffmpeg)" "$(command -v ffprobe)" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const [stateDir, envFile, root, codex, ffmpeg, ffprobe] = process.argv.slice(2);
const accountsDir = path.join(stateDir, 'weixin/accounts');
if (!fs.existsSync(accountsDir)) throw new Error('请先运行 npm run weixin:login。');
const accounts = fs.readdirSync(accountsDir).filter(name => name.endsWith('.json') && !name.endsWith('.sync.json') && !name.endsWith('.context-tokens.json'));
const selected = process.env.WEIXIN_ACCOUNT_ID ? `${process.env.WEIXIN_ACCOUNT_ID}.json` : accounts.length === 1 ? accounts[0] : null;
if (!selected || !accounts.includes(selected)) throw new Error('需要一个已绑定微信账号；多个账号时请设置 WEIXIN_ACCOUNT_ID。');
const account = JSON.parse(fs.readFileSync(path.join(accountsDir, selected), 'utf8'));
if (!account.user_id) throw new Error('绑定信息缺少扫码用户，请重新绑定。');
const settings = {
  WEIXIN_ACCOUNT_ID: selected.slice(0, -5),
  WEIXIN_DM_POLICY: 'allowlist', WEIXIN_ALLOWED_USERS: account.user_id,
  WEIXIN_GROUP_POLICY: 'disabled', CODEX_REAL_BIN: codex,
  CODEX_APP_SERVER_TRANSPORT: 'stdio', CODEX_DEFAULT_PROVIDER_PROFILE_ID: 'openai-default',
  CODEX_DEFAULT_MODEL: process.env.CODEX_DEFAULT_MODEL || 'gpt-6.1-sol',
  CODEX_DEFAULT_REASONING_EFFORT: process.env.CODEX_DEFAULT_REASONING_EFFORT || 'medium',
  CODEXBRIDGE_DEFAULT_CWD: path.join(root, 'workspace'),
  CODEXBRIDGE_FFMPEG_PATH: ffmpeg, CODEXBRIDGE_FFPROBE_PATH: ffprobe,
  CODEX_NATIVE_API_ENABLE: 'false', CODEXBRIDGE_ENABLE_AGENT_COMMAND: '0',
  CODEXBRIDGE_DEBUG_WEIXIN: '0',
};
fs.writeFileSync(envFile, Object.entries(settings).map(([key, value]) => `${key}="${value}"`).join('\n') + '\n', { mode: 0o600 });
console.log('已生成仅允许扫码账号的服务配置。');
JS
else
  echo "保留已有服务配置：${ENV_FILE}"
fi

export CODEXBRIDGE_STATE_DIR="$STATE_DIR"
export SERVICE_ENV_FILE="$ENV_FILE"
bash "${ROOT_DIR}/scripts/service/install-systemd-user.sh"
