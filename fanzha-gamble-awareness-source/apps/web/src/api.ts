export type Role = 'resident' | 'admin';
export type User = { id: number; username: string; role: Role };
export type Progress = {
  virtual_credits: number;
  spin_count: number;
  education_score: number;
  lessons_completed: number;
};
export type Lesson = {
  id: number;
  title: string;
  scam_message: string;
  question: string;
  options: string[];
};
export type PublicConfig = {
  site_title: string;
  announcement: string;
  stake_options: number[];
  maintenance_mode: boolean;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: '网络请求失败' }));
    throw new Error(body.error || '网络请求失败');
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  config: () => request<PublicConfig>('/api/public/config'),
  me: () => request<{ user: User; progress: Progress }>('/api/me'),
  register: (username: string, password: string) =>
    request<{ user: User }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  spin: (stake: number) =>
    request<{
      reels: string[][];
      multiplier: number;
      payout: number;
      virtualCredits: number;
      spinCount: number;
      scripted: boolean;
      lesson: Lesson | null;
    }>('/api/game/spin', { method: 'POST', body: JSON.stringify({ stake }) }),
  answer: (lessonId: number, selectedIndex: number) =>
    request<{ correct: boolean; explanation: string }>(`/api/lessons/${lessonId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ selectedIndex }),
    }),
  admin: () => request<AdminData>('/api/admin/config'),
  saveAdmin: (data: AdminUpdate) =>
    request<{ config: AdminData['config'] }>('/api/admin/config', { method: 'PUT', body: JSON.stringify(data) }),
  saveLesson: (id: number, data: LessonUpdate) =>
    request<{ lesson: AdminData['lessons'][number] }>(`/api/admin/lessons/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  resetUser: (id: number) => request<void>(`/api/admin/users/${id}/reset`, { method: 'POST' }),
};

export type AdminData = {
  config: {
    site_title: string;
    announcement: string;
    starting_credits: number;
    stake_options: number[];
    lesson_trigger_spin: number;
    scripted_mode: boolean;
    maintenance_mode: boolean;
  };
  lessons: Array<Lesson & { sort_order: number; trigger_spin: number; explanation: string; enabled: boolean; correct_index: number }>;
  stats: { residents: number; spins: number; correct_answers: number; total_answers: number };
  users: Array<{ id: number; username: string; created_at: string; virtual_credits: number; spin_count: number; education_score: number; lessons_completed: number }>;
};

export type AdminUpdate = {
  siteTitle: string;
  announcement: string;
  startingCredits: number;
  stakeOptions: number[];
  lessonTriggerSpin: number;
  scriptedMode: boolean;
  maintenanceMode: boolean;
};

export type LessonUpdate = {
  title: string;
  scamMessage: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  triggerSpin: number;
  enabled: boolean;
};
