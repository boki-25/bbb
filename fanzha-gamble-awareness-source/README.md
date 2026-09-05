# 守住钱袋子 · 社区反诈互动体验系统

一套前后端分离的反诈教育网站。视觉与交互参考常见麻将转轴类网络赌博页面，但所有积分均为虚拟积分，系统不包含真实充值、提现、支付、兑换或推广返利。

## 已实现

- 居民账号注册、登录、退出与个人学习进度
- 五列麻将主题转轴与移动端适配
- 服务端生成演示结果，前台不决定输赢
- “先给甜头 → 诱导充值 → 提现设卡”三段反诈剧情
- 节点答题、解析、反诈得分与学习记录
- 管理后台控制网站标题、公告、初始积分、积分档位、教学脚本和维护状态
- 管理后台编辑反诈话术、题目、选项、正确答案、解析与触发轮次
- 居民体验统计与一键重置进度
- 管理操作审计日志
- Docker Compose、PostgreSQL 持久化和 GitHub Actions 检查

## 项目结构

```text
apps/
  web/                 React + Vite 前台与管理界面
  api/                 Express API、认证与服务端教学逻辑
    db/init.sql         PostgreSQL 数据表和初始课程
docker-compose.yml     Web、API、数据库一键启动
.env.example           环境变量模板
```

前端只通过 `/api` 访问后端。Nginx 在正式环境中把 `/api/*` 转发给 API 服务，因此登录 Cookie 与页面保持同源，避免把登录令牌暴露给前端脚本。

## 本地启动

需要 Docker 与 Docker Compose。

1. 复制环境变量：

   ```bash
   cp .env.example .env
   ```

2. 修改 `.env` 中以下密码：

   - `POSTGRES_PASSWORD`
   - `DATABASE_URL` 中的数据库密码
   - `ADMIN_PASSWORD`（至少12位，建议随机生成）

3. 启动：

   ```bash
   docker compose up -d --build
   ```

4. 打开 `http://localhost:8080`。管理员账号由 `.env` 中的 `ADMIN_USERNAME` 与 `ADMIN_PASSWORD` 创建。

首次启动时数据库会自动加载 `apps/api/db/init.sql`。如果已有数据库卷，修改该 SQL 不会自动重放；上线后请使用正式迁移流程。

## 不使用 Docker 的开发方式

先准备 PostgreSQL 并执行 `apps/api/db/init.sql`，然后：

```bash
npm install
npm run dev
```

前台默认运行在 `http://localhost:5173`，API 默认运行在 `http://localhost:3001`。

## 检查与构建

```bash
npm run typecheck
npm test
npm run build
```

## 放入 GitHub

在 GitHub 新建空仓库后，在项目目录执行：

```bash
git init
git add .
git commit -m "feat: community anti-fraud awareness simulator"
git branch -M main
git remote add origin 你的仓库地址
git push -u origin main
```

仓库内的 CI 会在推送和 Pull Request 时自动执行类型检查、测试与构建。

## 上线建议

通用方案为单台云服务器或支持 Docker Compose 的容器平台：

1. 域名解析到服务器；
2. HTTPS 反向代理到 Web 容器的 `8080` 端口；
3. 将 `COOKIE_SECURE` 改为 `true`；
4. 将 `WEB_ORIGIN` 设置为正式 HTTPS 域名；
5. 数据库不要暴露公网端口；
6. 配置每日加密备份与日志保留周期；
7. 首次开放前由单位完成内容、隐私、网络安全与未成年人使用审查。

如果使用 Vercel、Cloudflare Pages 等纯前端托管，后端和 PostgreSQL 需要另外部署；不能只上传 `apps/web/dist` 就获得账号和后台功能。

## 安全与合规边界

- 不得接入支付、收款码、数字货币、充值、提现或可兑现奖励。
- 不得把“教学脚本可控制结果”的提示隐藏起来。
- 不收集居民身份证、银行卡、手机号等非必要信息。
- 密码使用 Node.js `scrypt` 加盐哈希；会话使用随机令牌、HttpOnly Cookie 和数据库过期时间。
- 管理员密码只放在服务器环境变量中，不提交到 GitHub。
- 正式面向公众时建议增加验证码/限流、管理员双因素认证、隐私政策、账号注销和数据保留规则。
- 文案中使用 110、96110 前，请根据活动所在地和主管部门要求复核。

## 教学流程

1. 居民阅读“反诈教学模拟”声明并登录。
2. 前两轮由后台脚本展示“先赢小利”的诱导方式。
3. 第3、6、9轮触发不同诈骗话术和选择题。
4. 系统解释正确止损、留证、银行止付与报警方式。
5. 管理后台查看完成率与正确率，不展示真实财务数据。

## 下一步接入你现有部署

确定云平台后，需要把域名、HTTPS、数据库、环境变量和备份方式按该平台调整。若原仓库已有代码，请先建立新分支再合并本项目，避免覆盖现有文件。
