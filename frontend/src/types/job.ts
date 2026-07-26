export type JobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'dead_lettered'

export type JobType = 'simulate_work' | 'generate_report' | 'send_email'

export type JobPriority = 'normal' | 'high' | 'low'

export interface Job {
  ulid: string
  type: JobType
  status: JobStatus
  priority: JobPriority
  progress: number
  payload_json: Record<string, unknown>
  result_json: Record<string, unknown> | null
  error_code: string | null
  error_message: string | null
  attempts: number
  cancel_requested: boolean
  created_at: string
  queued_at: string | null
  started_at: string | null
  completed_at: string | null
  failed_at: string | null
}

export interface JobExecution {
  id: number
  attempt: number
  worker_id: string
  status: 'running' | 'completed' | 'failed'
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  error_code: string | null
  error_message: string | null
}

export interface JobDetail extends Job {
  executions: JobExecution[]
}

export interface Summary {
  queued: number
  processing: number
  completed: number
  failed: number
  queue_depth: number
}

export interface PaginationMeta {
  current_page: number
  last_page: number
  per_page: number
  total: number
}

export interface Paginated<T> {
  data: T[]
  meta: PaginationMeta
}

export interface JobFilters {
  status?: JobStatus
  type?: JobType
  page?: number
  per_page?: number
}

export interface CreateJobBody {
  type: JobType
  priority?: JobPriority
  payload: Record<string, unknown>
}

export interface LoadTestBody {
  count: number
  duration_seconds: number
  failure_probability: number
  failure_type?: 'retryable' | 'non_retryable'
}

export interface User {
  id: number
  name: string
  email: string
}
