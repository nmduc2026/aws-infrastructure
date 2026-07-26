import type { JobStatus } from '../types/job'

export const STATUS_COLOR: Record<JobStatus, string> = {
  queued: 'default',
  processing: 'processing',
  completed: 'success',
  failed: 'error',
  cancelling: 'warning',
  cancelled: 'default',
  dead_lettered: 'magenta',
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Đang chờ',
  processing: 'Đang chạy',
  completed: 'Hoàn thành',
  failed: 'Thất bại',
  cancelling: 'Đang hủy',
  cancelled: 'Đã hủy',
  dead_lettered: 'Dead letter',
}

export const STATUS_HEX: Record<JobStatus, string> = {
  queued: '#8c8c8c',
  processing: '#1677ff',
  completed: '#52c41a',
  failed: '#ff4d4f',
  cancelling: '#faad14',
  cancelled: '#595959',
  dead_lettered: '#eb2f96',
}

export const TERMINAL_STATUSES: JobStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'dead_lettered',
]

export const JOB_TYPE_OPTIONS = [
  { value: 'simulate_work', label: 'Simulate Work' },
  { value: 'generate_report', label: 'Generate Report' },
  { value: 'send_email', label: 'Send Email' },
] as const

export { buildAntTheme } from './antdTheme'
