import express, { type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { z } from 'zod';
import { pool, query } from './db.js';
import {
  type AuthedRequest,
  createSession,
  destroySession,
  hashPassword,
  requireAdmin,
  requireAuth,
  verifyPassword,
} from './auth.js';
import { makeOutcome, payoutFor } from './game.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';
const secureCookie = process.env.COOKIE_SECURE === 'true';
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const allowedOrigins = webOrigin.split(',').map((item) => item.trim());

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !allowedOrigins.includes(origin)) return res.status(403).json({ error: '请求来源无效' });
  next();
});

function authRateLimit(req: Request, res: Response, next: () => void) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const current = authAttempts.get(key);
  if (!current || current.resetAt <= now) {
    if (authAttempts.size > 10_000) authAttempts.clear();
    authAttempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
    return next();
  }
  if (current.count >= 10) return res.status(429).json({ error: '尝试次数过多，请15分钟后再试' });
  current.count += 1;
  next();
}

const usernameSchema = z.string().trim().min(3, '账号至少3个字符').max(32).regex(/^[\p{L}\p{N}_-]+$/u, '账号只能包含文字、数字、下划线或短横线');
const passwordSchema = z.string().min(8, '密码至少8位').max(128);
const credentialsSchema = z.object({ username: usernameSchema, password: passwordSchema });

function sessionCookie(res: Response, token: string, maxAge: number) {
  res.cookie('fanzha_session', token, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie('fanzha_session', { httpOnly: true, secure: secureCookie, sameSite: 'lax', path: '/' });
}

function handleError(res: Response, error: unknown) {
  console.error(error);
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message || '参数错误' });
  return res.status(500).json({ error: '服务暂时不可用，请稍后重试' });
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'fanzha-api' }));

app.get('/api/public/config', async (_req, res) => {
  try {
    const result = await query(
      `SELECT site_title, announcement, stake_options, maintenance_mode
       FROM app_config WHERE id = 1`,
    );
    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  try {
    const body = credentialsSchema.parse(req.body);
    const existing = await query('SELECT 1 FROM users WHERE username = $1', [body.username]);
    if (existing.rowCount) return res.status(409).json({ error: '该账号已存在' });

    const config = await query<{ starting_credits: number }>('SELECT starting_credits FROM app_config WHERE id = 1');
    const passwordHash = await hashPassword(body.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query<{ id: string; username: string; role: 'resident' }>(
        `INSERT INTO users (username, password_hash) VALUES ($1, $2)
         RETURNING id, username, role`,
        [body.username, passwordHash],
      );
      const user = created.rows[0]!;
      await client.query(
        'INSERT INTO user_progress (user_id, virtual_credits) VALUES ($1, $2)',
        [user.id, config.rows[0]?.starting_credits ?? 1000],
      );
      await client.query('COMMIT');
      const session = await createSession(Number(user.id));
      sessionCookie(res, session.token, session.maxAge);
      return res.status(201).json({ user: { ...user, id: Number(user.id) } });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  try {
    const body = credentialsSchema.parse(req.body);
    const result = await query<{ id: string; username: string; password_hash: string; role: 'resident' | 'admin' }>(
      'SELECT id, username, password_hash, role FROM users WHERE username = $1',
      [body.username],
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    const session = await createSession(Number(user.id));
    sessionCookie(res, session.token, session.maxAge);
    res.json({ user: { id: Number(user.id), username: user.username, role: user.role } });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    await destroySession(req.cookies?.fanzha_session);
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/me', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const progress = await query(
      `SELECT virtual_credits, spin_count, education_score, lessons_completed
       FROM user_progress WHERE user_id = $1`,
      [req.user!.id],
    );
    res.json({ user: req.user, progress: progress.rows[0] });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/game/spin', requireAuth, async (req: AuthedRequest, res) => {
  const stakeBody = z.object({ stake: z.number().int().positive() });
  try {
    const { stake } = stakeBody.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const configResult = await client.query<{
        stake_options: number[];
        lesson_trigger_spin: number;
        scripted_mode: boolean;
        maintenance_mode: boolean;
      }>('SELECT stake_options, lesson_trigger_spin, scripted_mode, maintenance_mode FROM app_config WHERE id = 1 FOR SHARE');
      const config = configResult.rows[0]!;
      if (config.maintenance_mode) {
        await client.query('ROLLBACK');
        return res.status(503).json({ error: '体验课堂正在维护' });
      }
      if (!config.stake_options.includes(stake)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '无效的虚拟积分档位' });
      }

      const progressResult = await client.query<{ virtual_credits: number; spin_count: number }>(
        'SELECT virtual_credits, spin_count FROM user_progress WHERE user_id = $1 FOR UPDATE',
        [req.user!.id],
      );
      const progress = progressResult.rows[0];
      if (!progress) throw new Error('Progress not found');
      if (progress.virtual_credits < stake) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '虚拟积分不足，可联系活动工作人员重置体验' });
      }

      const nextSpin = progress.spin_count + 1;
      const outcome = makeOutcome(nextSpin, config.scripted_mode);
      const payout = payoutFor(stake, outcome.multiplier);
      const nextCredits = progress.virtual_credits - stake + payout;
      await client.query(
        `UPDATE user_progress SET virtual_credits = $2, spin_count = $3, updated_at = NOW()
         WHERE user_id = $1`,
        [req.user!.id, nextCredits, nextSpin],
      );
      await client.query(
        `INSERT INTO spin_events (user_id, stake, payout, reels, scripted)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [req.user!.id, stake, payout, JSON.stringify(outcome.reels), outcome.scripted],
      );

      const lessonResult = await client.query(
        `SELECT id, title, scam_message, question, options
         FROM lessons l
         WHERE l.enabled = TRUE
           AND ((l.sort_order = 1 AND $1 = $3) OR (l.sort_order <> 1 AND l.trigger_spin = $1))
           AND NOT EXISTS (
             SELECT 1 FROM lesson_answers a WHERE a.user_id = $2 AND a.lesson_id = l.id
           )
         LIMIT 1`,
        [nextSpin, req.user!.id, config.lesson_trigger_spin],
      );
      await client.query('COMMIT');
      res.json({
        reels: outcome.reels,
        multiplier: outcome.multiplier,
        payout,
        virtualCredits: nextCredits,
        spinCount: nextSpin,
        scripted: outcome.scripted,
        lesson: lessonResult.rows[0] || null,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/lessons/:id/answer', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const { selectedIndex } = z.object({ selectedIndex: z.number().int().min(0).max(10) }).parse(req.body);
    const lesson = await query<{ correct_index: number; explanation: string }>(
      'SELECT correct_index, explanation FROM lessons WHERE id = $1 AND enabled = TRUE',
      [id],
    );
    if (!lesson.rows[0]) return res.status(404).json({ error: '教学内容不存在' });
    const correct = selectedIndex === lesson.rows[0].correct_index;
    const inserted = await query(
      `INSERT INTO lesson_answers (user_id, lesson_id, selected_index, correct)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, lesson_id) DO NOTHING RETURNING id`,
      [req.user!.id, id, selectedIndex, correct],
    );
    if (inserted.rowCount) {
      await query(
        `UPDATE user_progress
         SET education_score = education_score + $2,
             lessons_completed = lessons_completed + 1,
             updated_at = NOW()
         WHERE user_id = $1`,
        [req.user!.id, correct ? 10 : 0],
      );
    }
    res.json({ correct, explanation: lesson.rows[0].explanation });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/admin/config', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [config, lessons, stats, users] = await Promise.all([
      query('SELECT * FROM app_config WHERE id = 1'),
      query('SELECT * FROM lessons ORDER BY sort_order'),
      query(`SELECT
        (SELECT COUNT(*)::int FROM users WHERE role = 'resident') AS residents,
        (SELECT COUNT(*)::int FROM spin_events) AS spins,
        (SELECT COUNT(*)::int FROM lesson_answers WHERE correct = TRUE) AS correct_answers,
        (SELECT COUNT(*)::int FROM lesson_answers) AS total_answers`),
      query(`SELECT u.id::int AS id, u.username, u.created_at, p.virtual_credits, p.spin_count,
        p.education_score, p.lessons_completed
        FROM users u JOIN user_progress p ON p.user_id = u.id
        WHERE u.role = 'resident' ORDER BY u.created_at DESC LIMIT 100`),
    ]);
    res.json({ config: config.rows[0], lessons: lessons.rows, stats: stats.rows[0], users: users.rows });
  } catch (error) {
    handleError(res, error);
  }
});

const lessonSchema = z.object({
  title: z.string().trim().min(4).max(100),
  scamMessage: z.string().trim().min(10).max(600),
  question: z.string().trim().min(6).max(300),
  options: z.array(z.string().trim().min(1).max(160)).min(2).max(5),
  correctIndex: z.number().int().min(0).max(4),
  explanation: z.string().trim().min(10).max(800),
  triggerSpin: z.number().int().min(1).max(30),
  enabled: z.boolean(),
}).refine((value) => value.correctIndex < value.options.length, { message: '正确答案序号超出选项数量' });

app.put('/api/admin/lessons/:id', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = lessonSchema.parse(req.body);
    const result = await query(
      `UPDATE lessons SET title = $2, scam_message = $3, question = $4,
       options = $5::jsonb, correct_index = $6, explanation = $7,
       trigger_spin = $8, enabled = $9 WHERE id = $1 RETURNING *`,
      [id, body.title, body.scamMessage, body.question, JSON.stringify(body.options), body.correctIndex, body.explanation, body.triggerSpin, body.enabled],
    );
    if (!result.rows[0]) return res.status(404).json({ error: '教学节点不存在' });
    await query('INSERT INTO audit_logs (actor_user_id, action, metadata) VALUES ($1, $2, $3::jsonb)', [
      req.user!.id,
      'lesson.update',
      JSON.stringify({ lessonId: id }),
    ]);
    res.json({ lesson: result.rows[0] });
  } catch (error) {
    handleError(res, error);
  }
});

const configSchema = z.object({
  siteTitle: z.string().trim().min(4).max(80),
  announcement: z.string().trim().min(10).max(240),
  startingCredits: z.number().int().min(100).max(100000),
  stakeOptions: z.array(z.number().int().min(1).max(10000)).min(1).max(8),
  lessonTriggerSpin: z.number().int().min(1).max(20),
  scriptedMode: z.boolean(),
  maintenanceMode: z.boolean(),
});

app.put('/api/admin/config', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const body = configSchema.parse(req.body);
    const result = await query(
      `UPDATE app_config SET
        site_title = $1, announcement = $2, starting_credits = $3,
        stake_options = $4::jsonb, lesson_trigger_spin = $5,
        scripted_mode = $6, maintenance_mode = $7, updated_at = NOW()
       WHERE id = 1 RETURNING *`,
      [
        body.siteTitle,
        body.announcement,
        body.startingCredits,
        JSON.stringify(body.stakeOptions),
        body.lessonTriggerSpin,
        body.scriptedMode,
        body.maintenanceMode,
      ],
    );
    await query('INSERT INTO audit_logs (actor_user_id, action, metadata) VALUES ($1, $2, $3::jsonb)', [
      req.user!.id,
      'config.update',
      JSON.stringify({ scriptedMode: body.scriptedMode, maintenanceMode: body.maintenanceMode }),
    ]);
    res.json({ config: result.rows[0] });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/admin/users/:id/reset', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const userId = z.coerce.number().int().positive().parse(req.params.id);
    const config = await query<{ starting_credits: number }>('SELECT starting_credits FROM app_config WHERE id = 1');
    await query(
      `UPDATE user_progress SET virtual_credits = $2, spin_count = 0,
       education_score = 0, lessons_completed = 0, updated_at = NOW() WHERE user_id = $1`,
      [userId, config.rows[0]!.starting_credits],
    );
    await query('DELETE FROM lesson_answers WHERE user_id = $1', [userId]);
    await query('INSERT INTO audit_logs (actor_user_id, action, metadata) VALUES ($1, $2, $3::jsonb)', [
      req.user!.id,
      'user.reset',
      JSON.stringify({ userId }),
    ]);
    res.status(204).end();
  } catch (error) {
    handleError(res, error);
  }
});

async function bootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || password.length < 12) {
    throw new Error('ADMIN_USERNAME and a strong ADMIN_PASSWORD (12+ chars) are required');
  }
  const exists = await query('SELECT 1 FROM users WHERE username = $1', [username]);
  if (!exists.rowCount) {
    const passwordHash = await hashPassword(password);
    const created = await query<{ id: string }>(
      `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id`,
      [username, passwordHash],
    );
    await query('INSERT INTO user_progress (user_id, virtual_credits) VALUES ($1, 1000)', [created.rows[0]!.id]);
  }
  await query('DELETE FROM sessions WHERE expires_at <= NOW()');
}

bootstrapAdmin()
  .then(() => app.listen(port, () => console.log(`API listening on ${port}`)))
  .catch((error) => {
    console.error('Startup failed', error);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
