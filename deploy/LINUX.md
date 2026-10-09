# Linux 服务器部署

基于 [Gan-Xing/CodexBridge](https://github.com/Gan-Xing/CodexBridge)，上游版本 `92166e02f4c7c8fcc0d223e894dd33664db754ea`。

包含修复：同一会话固定附件目录；回复分段去重；保留连续相同字符；部分发送失败时只重试未发送内容；隐藏附件清单；微信扫码超时重试。

## 1. 安装依赖

使用普通 Linux 用户运行。Ubuntu / Debian：

```bash
sudo apt-get update
sudo apt-get install -y git python3 ffmpeg
```

安装 Node.js 24 或更高版本，确认 `node --version` 和 `npm --version` 可用。然后在本仓库目录运行：

```bash
npm ci --ignore-scripts
npm install -g @openai/codex@0.147.0 --include=optional
codex --version
```

该 Codex 版本与本机验证一致。桥接通过 `tsx` 直接运行源码，不要求先编译整个上游工程。图片转码使用系统 `ffmpeg` / `ffprobe`，安装脚本会明确配置路径。

## 2. 在服务器登录 Codex

```bash
codex login --device-auth
codex login status
```

在浏览器完成自己的 ChatGPT 账号授权，可使用 Pro 的 Codex 额度。设备授权若不可用，按 [官方登录文档](https://learn.chatgpt.com/docs/auth) 检查账号设置。

## 3. 在服务器绑定微信

```bash
umask 077
npm run weixin:login
```

终端显示二维码地址及本地二维码文件路径。打开链接或把二维码文件复制到本机，用微信扫码。需等待终端显示登录成功后再继续。

这是服务器上的独立登录，仓库没有携带本机微信 token、Codex 登录文件或历史聊天。如果仍在本机运行相同微信绑定，迁移时停掉本机服务，避免两个进程同时轮询。

## 4. 安装并启动常驻服务

```bash
bash deploy/install-linux.sh
sudo loginctl enable-linger "$(id -un)"
bash scripts/service/status-systemd-user.sh
```

需要支持 systemd 用户服务的 Linux 主机；若当前 SSH 会话不能连接用户服务总线，使用该用户正常登录后执行。安装脚本默认只允许扫码账号、禁用群聊和额外 HTTP API，并保留已有服务配置。服务会开机启动，异常退出后重启。

文件位置：

- 服务配置：`~/.config/codexbridge/weixin.service.env`。
- 微信绑定及会话：`~/.codexbridge/`。
- Codex 登录及历史：`~/.codex/`。
- Codex 工作目录：本仓库的 `workspace/`，已排除出 Git。

首次使用请在微信发 `hi`、`/status`，再连续请求生成两张图片，并确认都收到。

## 日常操作

```bash
bash scripts/service/logs-systemd-user.sh --follow
bash scripts/service/restart-systemd-user.sh
systemctl --user stop com.ganxing.codexbridge-weixin.service
```

更新时先停止服务，再 `git pull`、`npm ci --ignore-scripts`，最后重启。保持上述状态目录即可保留绑定和聊天；重装操作系统前在仓库之外备份这些目录。

微信发送限流或登录失效时，请查看日志并在微信重新发一条消息；需要时重新扫码绑定。

## 验证范围

微信图片回传已经在本机真实验证，收发、会话、连接及本次修复的相关测试已通过。本机没有运行中的 Linux / Docker 环境，未实际安装 Linux systemd 服务。上游全量类型检查仍有 provider-relay 示例依赖等原有错误，不作为本部署的前置步骤。
