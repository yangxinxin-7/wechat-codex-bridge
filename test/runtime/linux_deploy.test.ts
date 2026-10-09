import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('Linux installer generates owner-only persistent service configuration without copying credentials', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-linux-install-'));
  const project = path.join(temp, 'project');
  const bin = path.join(temp, 'bin');
  const state = path.join(temp, 'state');
  const config = path.join(temp, 'config');
  fs.mkdirSync(path.join(project, 'deploy'), { recursive: true });
  fs.copyFileSync('deploy/install-linux.sh', path.join(project, 'deploy/install-linux.sh'));
  fs.cpSync('scripts/service', path.join(project, 'scripts/service'), { recursive: true });
  fs.cpSync('ops/systemd', path.join(project, 'ops/systemd'), { recursive: true });
  fs.mkdirSync(path.join(project, 'node_modules/tsx'), { recursive: true });
  fs.mkdirSync(path.join(state, 'weixin/accounts'), { recursive: true });
  fs.writeFileSync(path.join(state, 'weixin/accounts/bot.json'), JSON.stringify({ user_id: 'test-owner', token: 'test-secret-not-for-env' }));
  fs.mkdirSync(bin);
  for (const [name, body] of Object.entries({
    uname: 'echo Linux', systemctl: 'exit 0', loginctl: 'echo Linger=yes',
    codex: 'exit 0', ffmpeg: 'exit 0', ffprobe: 'exit 0', pkill: 'exit 0',
  })) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  try {
    execFileSync('bash', [path.join(project, 'deploy/install-linux.sh')], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEXBRIDGE_STATE_DIR: state,
        XDG_CONFIG_HOME: config, SERVICE_LOG_DIR: path.join(temp, 'logs'), NODE_BIN: process.execPath },
    });
    const envFile = path.join(config, 'codexbridge/weixin.service.env');
    const content = fs.readFileSync(envFile, 'utf8');
    assert.match(content, /WEIXIN_DM_POLICY="allowlist"/);
    assert.match(content, /WEIXIN_ALLOWED_USERS="test-owner"/);
    assert.match(content, /CODEX_NATIVE_API_ENABLE="false"/);
    assert.match(content, /CODEXBRIDGE_FFMPEG_PATH=/);
    assert.doesNotMatch(content, /test-secret-not-for-env/);
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
    const unit = fs.readFileSync(path.join(config, 'systemd/user/com.ganxing.codexbridge-weixin.service'), 'utf8');
    assert.match(unit, /Restart=always/);
    assert.ok(unit.includes(state));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
