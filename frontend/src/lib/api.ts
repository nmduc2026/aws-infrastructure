import type {
  CreateJobBody,
  Job,
  JobDetail,
  JobFilters,
  LoadTestBody,
  Paginated,
  Summary,
  User,
} from '../types/job'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api'

export class ApiError extends Error {
  status: number
  errors?: Record<string, string[]>

  constructor(status: number, message: string, errors?: Record<string, string[]>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
  }
}

let token: string | null = localStorage.getItem('taskflow_token')

export function getToken(): string | null {
  return token
}

export function setToken(t: string | null) {
  token = t
  if (t) {
    localStorage.setItem('taskflow_token', t)
  } else {
    localStorage.removeItem('taskflow_token')
  }
}

function buildQuery(params?: JobFilters): string {
  if (!params) return ''
  const search = new URLSearchParams()
  if (params.status) search.set('status', params.status)
  if (params.type) search.set('type', params.type)
  if (params.page) search.set('page', String(params.page))
  if (params.per_page) search.set('per_page', String(params.per_page))
  const query = search.toString()
  return query ? `?${query}` : ''
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })

  if (res.status === 401) {
    setToken(null)
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login'
    }
    throw new ApiError(401, 'Phiên đăng nhập đã hết hạn')
  }

  if (res.status === 204) return undefined as T

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new ApiError(
      res.status,
      (data as { message?: string }).message ?? `HTTP ${res.status}`,
      (data as { errors?: Record<string, string[]> }).errors,
    )
  }

  return data as T
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (name: string, email: string, password: string, password_confirmation: string) =>
    request<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, password_confirmation }),
    }),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  me: () => request<User>('/auth/me'),

  jobs: (params?: JobFilters) =>
    request<Paginated<Job>>(`/jobs${buildQuery(params)}`),

  job: (ulid: string) => request<JobDetail>(`/jobs/${ulid}`),

  createJob: (body: CreateJobBody) =>
    request<Job>('/jobs', { method: 'POST', body: JSON.stringify(body) }),

  cancelJob: (ulid: string) =>
    request<Job>(`/jobs/${ulid}/cancel`, { method: 'POST' }),

  retryJob: (ulid: string) =>
    request<Job>(`/jobs/${ulid}/retry`, { method: 'POST' }),

  summary: () => request<Summary>('/dashboard/summary'),

  loadTest: (body: LoadTestBody) =>
    request<{ created: number; job_ids: string[] }>('/load-tests', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
