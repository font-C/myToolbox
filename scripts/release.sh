#!/usr/bin/env bash
# 完整发布流程：版本号 → 构建 → git push + tag → GitHub Release（REST API）
# GitHub Release 页面的 "Latest" 标记是按 semver 自动的：每次发布版本号更大的 Release，
# 旧的 Release 会自动从 Latest 降级为普通 Release，相当于"原来的改为对应版本"。
#
# 环境变量：
#   GITHUB_TOKEN   必填，需要有 repo 写权限（Personal Access Token）
#   GITHUB_REPO    可选，默认 font-C/myToolbox
# 用法：GITHUB_TOKEN=xxx ./scripts/release.sh
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="${GITHUB_REPO:-font-C/myToolbox}"
API="https://api.github.com/repos/${REPO}"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "❌ 请设置 GITHUB_TOKEN 环境变量" >&2
  exit 1
fi

# 1. 从 package.json 读版本号
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
echo "📦 版本 ${TAG}"

# 2. 校验版本号一致性
PKG_VER=$(cat package.json | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
CONF_VER=$(cat src-tauri/tauri.conf.json | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
if [[ "$PKG_VER" != "$CONF_VER" || "$PKG_VER" != "$VERSION" ]]; then
  echo "❌ 版本号不一致: package.json=${PKG_VER} tauri.conf.json=${CONF_VER}" >&2
  exit 1
fi

# 3. 构建
echo "🔨 npm run tauri build ..."
npm run tauri build

# 4. 定位构建产物
BUNDLE="src-tauri/target/release/bundle"
DMG=$(find "$BUNDLE/dmg" -maxdepth 1 -name "*.dmg" | head -1)
APP=$(find "$BUNDLE/macos" -maxdepth 1 -name "*.app" -type d | head -1)
if [[ -z "$DMG" ]]; then
  echo "❌ 未找到 dmg 产物" >&2
  exit 1
fi
echo "  dmg: ${DMG}"
echo "  app: ${APP:-（无）}"

# 5. 把 .app 打成 tar.gz（GitHub Release 上传 .app 目录需要先归档）
APP_TGZ=""
if [[ -n "$APP" ]]; then
  APP_TGZ="${APP%.app}.tar.gz"
  echo "🗜  压缩 .app → ${APP_TGZ}"
  tar -czf "$APP_TGZ" -C "$(dirname "$APP")" "$(basename "$APP")"
fi

# 6. git 提交 + 打 tag + 推送
echo "📝 git commit + push + tag"
git add -A
if ! git diff --cached --quiet; then
  git commit -m "chore: bump version to ${TAG}"
fi
# tag 存在则删掉重建（幂等）
if git rev-parse "${TAG}" >/dev/null 2>&1; then
  git tag -d "${TAG}"
fi
git tag "${TAG}"
git push github HEAD 2>&1 | tail -3 || true
git push github "refs/tags/${TAG}" 2>&1 | tail -3 || true

# 7. 检查远端 tag 是否已被 GitHub Release 占用
EXISTING=$(curl -sL -H "Authorization: Bearer ${GITHUB_TOKEN}" "${API}/releases/tags/${TAG}")
if ! echo "$EXISTING" | grep -q '"id"'; then
  EXISTING=""
fi

# 8. 创建 Release（或复用已有的同名 tag release）
echo "🚀 创建 GitHub Release ${TAG}"
if [[ -n "$EXISTING" ]]; then
  echo "  tag ${TAG} 已有 release，复用并更新描述"
  REL_ID=$(echo "$EXISTING" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).id")
else
  REL_JSON=$(curl -sL -X POST -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -d "{
      \"tag_name\": \"${TAG}\",
      \"name\": \"${TAG}\",
      \"generate_release_notes\": true,
      \"draft\": false,
      \"prerelease\": false
    }" "${API}/releases")
  if ! echo "$REL_JSON" | grep -q '"id"'; then
    echo "❌ 创建 Release 失败: $(echo "$REL_JSON" | head -c 500)" >&2
    exit 1
  fi
  REL_ID=$(echo "$REL_JSON" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).id")
fi

UPLOAD_URL="${API}/releases/${REL_ID}/assets?name="

# 9. 上传 dmg
echo "⬆️  上传 DMG..."
curl -sL -X POST \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@${DMG}" \
  "${UPLOAD_URL}$(basename "$DMG")" >/dev/null

# 10. 上传 .app.tar.gz
if [[ -n "$APP_TGZ" && -f "$APP_TGZ" ]]; then
  echo "⬆️  上传 App..."
  curl -sL -X POST \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Content-Type: application/gzip" \
    --data-binary "@${APP_TGZ}" \
    "${UPLOAD_URL}$(basename "$APP_TGZ")" >/dev/null
fi

# 11. 输出 Release URL
RELEASE_URL=$(curl -sL -H "Authorization: Bearer ${GITHUB_TOKEN}" "${API}/releases/${REL_ID}" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).html_url")
echo ""
echo "✅ 发布完成"
echo "   ${RELEASE_URL}"
echo ""
echo "ℹ️  GitHub Release 页面上，v${VERSION} 现在是 Latest；"
echo "   之前的 v0.1.0 自动降级为普通 Release。"
