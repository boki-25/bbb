CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'resident' CHECK (role IN ('resident', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  site_title VARCHAR(80) NOT NULL DEFAULT '守住钱袋子 · 反诈体验课堂',
  announcement VARCHAR(240) NOT NULL DEFAULT '本页面为反诈教育模拟，不含真实充值、提现或任何现金奖励。',
  starting_credits INTEGER NOT NULL DEFAULT 1000 CHECK (starting_credits BETWEEN 100 AND 100000),
  stake_options JSONB NOT NULL DEFAULT '[10,20,50,100]'::jsonb,
  lesson_trigger_spin INTEGER NOT NULL DEFAULT 3 CHECK (lesson_trigger_spin BETWEEN 1 AND 20),
  scripted_mode BOOLEAN NOT NULL DEFAULT TRUE,
  maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_progress (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  virtual_credits INTEGER NOT NULL DEFAULT 1000,
  spin_count INTEGER NOT NULL DEFAULT 0,
  education_score INTEGER NOT NULL DEFAULT 0,
  lessons_completed INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lessons (
  id BIGSERIAL PRIMARY KEY,
  sort_order INTEGER NOT NULL UNIQUE,
  trigger_spin INTEGER NOT NULL,
  title VARCHAR(100) NOT NULL,
  scam_message TEXT NOT NULL,
  question TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_index INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO lessons (sort_order, trigger_spin, title, scam_message, question, options, correct_index, explanation)
VALUES
  (1, 3, '第一步：先让你尝到甜头', '“新用户必中！再玩几把，收益还能翻倍。”', '遇到连续小额盈利，最安全的做法是什么？', '["继续加大投入", "停止操作并核实平台资质", "邀请亲友一起参加"]', 1, '诈骗平台常先制造小额盈利，让人放松警惕。应立即停止，并通过官方渠道核实。'),
  (2, 6, '第二步：诱导充值解锁大奖', '“只差最后一次充值，完成后可立即提现全部奖金。”', '对方要求充值才能提现，你应该怎么做？', '["按要求充值", "借钱完成任务", "拒绝转账、保存证据并报警"]', 2, '正规平台不会要求先充值、缴税或交保证金才能提现。不要继续转账。'),
  (3, 9, '第三步：提现时层层设卡', '“账户异常，请再缴纳20%保证金解除风控。”', '已经转过钱且无法提现，下一步是什么？', '["继续交保证金", "联系警方和银行止付", "等待客服处理"]', 1, '立即停止操作，保留聊天、账户和转账记录，联系银行并拨打110或96110。')
ON CONFLICT (sort_order) DO NOTHING;

CREATE TABLE IF NOT EXISTS spin_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stake INTEGER NOT NULL,
  payout INTEGER NOT NULL,
  reels JSONB NOT NULL,
  scripted BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lesson_answers (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id BIGINT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  selected_index INTEGER NOT NULL,
  correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_spin_events_user_created ON spin_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
