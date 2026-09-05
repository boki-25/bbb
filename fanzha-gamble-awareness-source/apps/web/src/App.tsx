import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type AdminData, type Lesson, type Progress, type PublicConfig, type User } from './api';

const DEFAULT_REELS = [
  ['●●', '竹', '八萬'],
  ['中', '發', '元宝'],
  ['警盾', '中', '竹'],
  ['發', '八萬', '●●'],
  ['竹', '元宝', '中'],
];

type Page = 'game' | 'learning' | 'admin';

export default function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>('game');

  async function refreshSession() {
    try {
      const [siteConfig, session] = await Promise.all([api.config(), api.me().catch(() => null)]);
      setConfig(siteConfig);
      if (session) {
        setUser(session.user);
        setProgress(session.progress);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  if (loading) return <LoadingScreen />;
  if (!config) return <ErrorScreen message="暂时无法连接反诈体验服务" />;
  if (!user || !progress) {
    return <AuthScreen config={config} onAuthenticated={refreshSession} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="shield-logo" aria-hidden="true">盾</span>
          <div>
            <strong>{config.site_title}</strong>
            <span>社区反诈宣传教育体验</span>
          </div>
        </div>
        <nav aria-label="主要导航">
          <button className={page === 'game' ? 'active' : ''} onClick={() => setPage('game')}>模拟体验</button>
          <button className={page === 'learning' ? 'active' : ''} onClick={() => setPage('learning')}>学习记录</button>
          {user.role === 'admin' && <button className={page === 'admin' ? 'active' : ''} onClick={() => setPage('admin')}>管理后台</button>}
        </nav>
        <div className="account-block">
          <span>{user.username}</span>
          <button
            className="text-button"
            onClick={async () => {
              await api.logout();
              setUser(null);
              setProgress(null);
            }}
          >退出</button>
        </div>
      </header>

      <div className="notice-bar"><strong>重要：</strong>{config.announcement}</div>

      {page === 'game' && (
        <GameScreen
          config={config}
          progress={progress}
          onProgress={(next) => setProgress((current) => current ? { ...current, ...next } : current)}
        />
      )}
      {page === 'learning' && <LearningScreen progress={progress} />}
      {page === 'admin' && user.role === 'admin' && <AdminScreen onConfigChange={setConfig} />}

      <footer>
        <span>本系统不提供充值、提现、支付、兑换或任何真实收益。</span>
        <strong>遇到诈骗请立即拨打 110；收到 96110 来电请及时接听。</strong>
      </footer>
    </div>
  );
}

function LoadingScreen() {
  return <main className="center-screen"><div className="loading-ring" /><p>正在进入反诈体验课堂…</p></main>;
}

function ErrorScreen({ message }: { message: string }) {
  return <main className="center-screen"><span className="big-shield">盾</span><h1>{message}</h1><button onClick={() => location.reload()}>重新加载</button></main>;
}

function AuthScreen({ config, onAuthenticated }: { config: PublicConfig; onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') await api.login(username, password);
      else await api.register(username, password);
      await onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="police-badge">反诈宣传</div>
        <h1>{config.site_title}</h1>
        <p>亲身识别网络赌博骗局的套路：先给甜头、诱导充值、提现设卡、继续追款。</p>
        <div className="safety-card">
          <strong>这是教学模拟，不是赌博网站</strong>
          <span>全程仅使用虚拟积分，不连接支付，不产生任何真实收益。</span>
        </div>
        <ul>
          <li><span>01</span>体验后台如何操纵“输赢”</li>
          <li><span>02</span>识别充值、解冻、保证金话术</li>
          <li><span>03</span>学习止损、留证和报警步骤</li>
        </ul>
      </section>
      <section className="auth-panel">
        <div className="auth-tabs" role="tablist">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>创建体验账号</button>
        </div>
        <form onSubmit={submit}>
          <label>账号<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="3–32个字符" required /></label>
          <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="至少8位" required /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button" disabled={submitting}>{submitting ? '请稍候…' : mode === 'login' ? '进入体验课堂' : '创建账号并进入'}</button>
        </form>
        <p className="privacy-note">请勿使用银行卡、支付平台或其他重要账号的相同密码。</p>
      </section>
    </main>
  );
}

function GameScreen({ config, progress, onProgress }: {
  config: PublicConfig;
  progress: Progress;
  onProgress: (patch: Partial<Progress>) => void;
}) {
  const stakes = config.stake_options;
  const [stakeIndex, setStakeIndex] = useState(0);
  const [reels, setReels] = useState(DEFAULT_REELS);
  const [spinning, setSpinning] = useState(false);
  const [resultText, setResultText] = useState('点击开始，观察“先赢后输”的诱导套路');
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState('');

  const stake = stakes[Math.min(stakeIndex, stakes.length - 1)] || 10;

  async function spin() {
    if (spinning || progress.virtual_credits < stake) return;
    setSpinning(true);
    setError('');
    setResultText('后台正在生成教学结果…');
    try {
      const result = await api.spin(stake);
      await new Promise((resolve) => setTimeout(resolve, 850));
      setReels(result.reels);
      onProgress({ virtual_credits: result.virtualCredits, spin_count: result.spinCount });
      setResultText(result.payout > 0 ? `模拟获得 ${result.payout} 虚拟积分 · 这类“甜头”可能是诱饵` : '本轮未得分 · 诈骗平台可随时改变后台结果');
      if (result.lesson) setLesson(result.lesson);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSpinning(false);
    }
  }

  return (
    <main className="game-layout">
      <section className="game-stage">
        <div className="simulation-ribbon">教学模拟 · 结果可由后台控制 · 禁止真实投注</div>
        <div className="game-title-row">
          <div><span>体验场景</span><h1>“2000路中奖组合”话术模拟</h1></div>
          <div className="round-badge">第 {progress.spin_count + 1} 轮</div>
        </div>
        <div className="multipliers" aria-label="模拟倍数">
          {[1, 2, 3, 5].map((number, index) => <span key={number} className={index === 0 ? 'lit' : ''}>×{number}</span>)}
        </div>
        <div className={`reel-board ${spinning ? 'spinning' : ''}`} aria-live="polite">
          {reels.map((column, columnIndex) => (
            <div className="reel" key={columnIndex}>
              {column.map((symbol, rowIndex) => (
                <div className={`tile tile-${symbol === '中' ? 'red' : symbol === '發' ? 'green' : 'blue'}`} key={`${columnIndex}-${rowIndex}`}>
                  {symbol === '警盾' ? <span className="tile-shield">盾</span> : symbol}
                </div>
              ))}
            </div>
          ))}
          <div className="payline" />
        </div>
        <div className="result-banner">{resultText}</div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="game-controls">
          <div className="metric"><span>虚拟积分</span><strong>{progress.virtual_credits}</strong></div>
          <div className="stake-picker">
            <button aria-label="减少虚拟投入" onClick={() => setStakeIndex((value) => Math.max(0, value - 1))}>−</button>
            <div><span>本轮虚拟投入</span><strong>{stake}</strong></div>
            <button aria-label="增加虚拟投入" onClick={() => setStakeIndex((value) => Math.min(stakes.length - 1, value + 1))}>＋</button>
          </div>
          <button className="spin-button" onClick={spin} disabled={spinning || config.maintenance_mode}>
            <span>{spinning ? '演示中' : '开始'}</span>
            <small>仅虚拟积分</small>
          </button>
          <div className="metric"><span>反诈得分</span><strong>{progress.education_score}</strong></div>
        </div>
      </section>

      <aside className="risk-panel">
        <div className="risk-heading"><span>风险识别</span><strong>请边体验边观察</strong></div>
        <RiskItem index="01" title="后台可控" text="你看到的输赢，可以是平台预先安排的剧本。" active={progress.spin_count >= 1} />
        <RiskItem index="02" title="小利诱导" text="先让你小额获利，再催促加大投入。" active={progress.spin_count >= 2} />
        <RiskItem index="03" title="提现设卡" text="以税费、保证金、解冻费为由继续要钱。" active={progress.spin_count >= 6} />
        <div className="emergency-card"><strong>发现异常，立刻“四停”</strong><p>停止操作 · 停止转账<br />停止沟通 · 停止拉人</p><span>保留证据，拨打 110 / 96110</span></div>
      </aside>

      {lesson && <LessonModal lesson={lesson} onClose={(correct) => {
        if (correct) onProgress({ education_score: progress.education_score + 10, lessons_completed: progress.lessons_completed + 1 });
        else onProgress({ lessons_completed: progress.lessons_completed + 1 });
        setLesson(null);
      }} />}
    </main>
  );
}

function RiskItem({ index, title, text, active }: { index: string; title: string; text: string; active: boolean }) {
  return <div className={`risk-item ${active ? 'active' : ''}`}><span>{index}</span><div><strong>{title}</strong><p>{text}</p></div></div>;
}

function LessonModal({ lesson, onClose }: { lesson: Lesson; onClose: (correct: boolean) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<{ correct: boolean; explanation: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (selected === null) return;
    setBusy(true);
    try {
      setResult(await api.answer(lesson.id, selected));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="lesson-modal" role="dialog" aria-modal="true" aria-labelledby="lesson-title">
        <div className="lesson-tag">反诈拆解</div>
        <h2 id="lesson-title">{lesson.title}</h2>
        <blockquote>{lesson.scam_message}</blockquote>
        <h3>{lesson.question}</h3>
        <div className="answer-list">
          {lesson.options.map((option, index) => (
            <button key={option} disabled={!!result} className={selected === index ? 'selected' : ''} onClick={() => setSelected(index)}>
              <span>{String.fromCharCode(65 + index)}</span>{option}
            </button>
          ))}
        </div>
        {result ? (
          <div className={`answer-result ${result.correct ? 'correct' : 'wrong'}`}>
            <strong>{result.correct ? '回答正确' : '请记住正确做法'}</strong>
            <p>{result.explanation}</p>
            <button className="primary-button" onClick={() => onClose(result.correct)}>继续体验</button>
          </div>
        ) : (
          <button className="primary-button" disabled={selected === null || busy} onClick={submit}>{busy ? '提交中…' : '确认选择'}</button>
        )}
      </section>
    </div>
  );
}

function LearningScreen({ progress }: { progress: Progress }) {
  const completion = Math.min(100, Math.round((progress.lessons_completed / 3) * 100));
  return (
    <main className="learning-page">
      <section className="learning-summary">
        <span className="eyebrow">个人学习记录</span>
        <h1>你已经识别了 {progress.lessons_completed} 个诈骗节点</h1>
        <div className="progress-track"><span style={{ width: `${completion}%` }} /></div>
        <div className="learning-stats">
          <div><strong>{progress.spin_count}</strong><span>体验轮次</span></div>
          <div><strong>{progress.education_score}</strong><span>反诈得分</span></div>
          <div><strong>{completion}%</strong><span>课程进度</span></div>
        </div>
      </section>
      <section className="action-guide">
        <h2>如果现实中遇到类似情况</h2>
        <ol>
          <li><strong>立即止损</strong><span>停止充值、转账、缴纳保证金或解冻费。</span></li>
          <li><strong>保存证据</strong><span>保存网址、聊天、对方账号、收款码和转账记录。</span></li>
          <li><strong>快速报警</strong><span>拨打110，并尽快联系银行申请紧急止付。</span></li>
          <li><strong>不要追款</strong><span>警惕自称“黑客”“律师”能追回资金的二次诈骗。</span></li>
        </ol>
      </section>
    </main>
  );
}

function AdminScreen({ onConfigChange }: { onConfigChange: (config: PublicConfig) => void }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api.admin().then(setData).catch((err) => setError(err.message)); }, []);
  const accuracy = useMemo(() => {
    if (!data?.stats.total_answers) return 0;
    return Math.round((data.stats.correct_answers / data.stats.total_answers) * 100);
  }, [data]);

  if (error) return <main className="admin-page"><div className="form-error">{error}</div></main>;
  if (!data) return <main className="admin-page"><p>正在加载管理数据…</p></main>;

  const config = data.config;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    const updated = await api.saveAdmin({
      siteTitle: config.site_title,
      announcement: config.announcement,
      startingCredits: config.starting_credits,
      stakeOptions: config.stake_options,
      lessonTriggerSpin: config.lesson_trigger_spin,
      scriptedMode: config.scripted_mode,
      maintenanceMode: config.maintenance_mode,
    });
    setData((current) => current ? { ...current, config: updated.config } : current);
    onConfigChange({
      site_title: updated.config.site_title,
      announcement: updated.config.announcement,
      stake_options: updated.config.stake_options,
      maintenance_mode: updated.config.maintenance_mode,
    });
    setMessage('设置已保存并立即生效');
  }

  function patchConfig(patch: Partial<AdminData['config']>) {
    setData((current) => current ? { ...current, config: { ...current.config, ...patch } } : current);
  }

  return (
    <main className="admin-page">
      <div className="admin-heading"><div><span className="eyebrow">管理后台</span><h1>活动控制台</h1></div><div className="admin-safe">所有参数仅影响虚拟教学积分</div></div>
      <section className="stat-grid">
        <div><span>体验居民</span><strong>{data.stats.residents}</strong></div>
        <div><span>模拟轮次</span><strong>{data.stats.spins}</strong></div>
        <div><span>答题总数</span><strong>{data.stats.total_answers}</strong></div>
        <div><span>正确率</span><strong>{accuracy}%</strong></div>
      </section>
      <div className="admin-grid">
        <form className="config-card" onSubmit={save}>
          <h2>前台参数</h2>
          <label>网站标题<input value={config.site_title} onChange={(e) => patchConfig({ site_title: e.target.value })} /></label>
          <label>顶部公告<textarea value={config.announcement} onChange={(e) => patchConfig({ announcement: e.target.value })} /></label>
          <div className="form-row">
            <label>新账号虚拟积分<input type="number" value={config.starting_credits} onChange={(e) => patchConfig({ starting_credits: Number(e.target.value) })} /></label>
            <label>首次提示轮次<input type="number" min="1" max="20" value={config.lesson_trigger_spin} onChange={(e) => patchConfig({ lesson_trigger_spin: Number(e.target.value) })} /></label>
          </div>
          <label>积分档位（逗号分隔）<input value={config.stake_options.join(', ')} onChange={(e) => patchConfig({ stake_options: e.target.value.split(',').map(Number).filter((value) => Number.isFinite(value) && value > 0) })} /></label>
          <label className="switch-row"><input type="checkbox" checked={config.scripted_mode} onChange={(e) => patchConfig({ scripted_mode: e.target.checked })} /><span><strong>启用“先赢后输”教学脚本</strong><small>前台会明确告知结果由后台控制</small></span></label>
          <label className="switch-row"><input type="checkbox" checked={config.maintenance_mode} onChange={(e) => patchConfig({ maintenance_mode: e.target.checked })} /><span><strong>暂停居民体验</strong><small>登录和学习记录仍可访问</small></span></label>
          {message && <div className="save-message">{message}</div>}
          <button className="primary-button">保存设置</button>
        </form>
        <section className="lesson-card">
          <h2>教学节点</h2>
          {data.lessons.map((lesson) => (
            <LessonEditor key={lesson.id} lesson={lesson} onSaved={(saved) => {
              setData((current) => current ? { ...current, lessons: current.lessons.map((item) => item.id === saved.id ? saved : item) } : current);
            }} />
          ))}
          <div className="admin-note"><strong>合规边界</strong><p>系统没有支付接口、充值入口、提现接口或现金兑换。教学脚本必须始终向体验者明确披露。</p></div>
        </section>
      </div>
      <section className="user-card">
        <div className="user-card-heading"><div><h2>居民体验记录</h2><p>仅显示最近注册的100个体验账号</p></div></div>
        <div className="user-table-wrap">
          <table>
            <thead><tr><th>账号</th><th>体验轮次</th><th>完成节点</th><th>反诈得分</th><th>虚拟积分</th><th>操作</th></tr></thead>
            <tbody>
              {data.users.map((resident) => (
                <tr key={resident.id}>
                  <td>{resident.username}</td><td>{resident.spin_count}</td><td>{resident.lessons_completed}/3</td><td>{resident.education_score}</td><td>{resident.virtual_credits}</td>
                  <td><button className="small-button" onClick={async () => {
                    if (!confirm(`确认重置账号“${resident.username}”的体验进度？`)) return;
                    await api.resetUser(resident.id);
                    setData((current) => current ? { ...current, users: current.users.map((item) => item.id === resident.id ? { ...item, spin_count: 0, lessons_completed: 0, education_score: 0, virtual_credits: current.config.starting_credits } : item) } : current);
                  }}>重置进度</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function LessonEditor({ lesson, onSaved }: { lesson: AdminData['lessons'][number]; onSaved: (lesson: AdminData['lessons'][number]) => void }) {
  const [draft, setDraft] = useState(lesson);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);

  async function save() {
    setStatus('保存中…');
    try {
      const result = await api.saveLesson(draft.id, {
        title: draft.title,
        scamMessage: draft.scam_message,
        question: draft.question,
        options: draft.options,
        correctIndex: draft.correct_index,
        explanation: draft.explanation,
        triggerSpin: draft.trigger_spin,
        enabled: draft.enabled,
      });
      setDraft(result.lesson);
      onSaved(result.lesson);
      setStatus('已保存');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败');
    }
  }

  return (
    <div className="lesson-editor">
      <button className="lesson-summary" onClick={() => setOpen((value) => !value)}>
        <span>{lesson.sort_order.toString().padStart(2, '0')}</span>
        <div><strong>{lesson.title}</strong><p>第 {lesson.trigger_spin} 轮触发 · 点击编辑</p></div>
        <em>{lesson.enabled ? '启用' : '停用'}</em>
      </button>
      {open && <div className="lesson-form">
        <label>标题<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>诈骗话术<textarea value={draft.scam_message} onChange={(e) => setDraft({ ...draft, scam_message: e.target.value })} /></label>
        <label>问题<input value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} /></label>
        <label>答案选项（每行一个）<textarea value={draft.options.join('\n')} onChange={(e) => setDraft({ ...draft, options: e.target.value.split('\n').filter(Boolean) })} /></label>
        <label>解析<textarea value={draft.explanation} onChange={(e) => setDraft({ ...draft, explanation: e.target.value })} /></label>
        <div className="form-row">
          <label>触发轮次<input type="number" min="1" max="30" value={draft.trigger_spin} onChange={(e) => setDraft({ ...draft, trigger_spin: Number(e.target.value) })} /></label>
          <label>正确答案序号<input type="number" min="1" max={draft.options.length} value={draft.correct_index + 1} onChange={(e) => setDraft({ ...draft, correct_index: Number(e.target.value) - 1 })} /></label>
        </div>
        <div className="form-row">
          <label className="switch-row"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /><span><strong>启用节点</strong></span></label>
        </div>
        <div className="lesson-save-row"><span>{status}</span><button className="small-button" onClick={save}>保存节点</button></div>
      </div>}
    </div>
  );
}
