import type { Job } from '../types/job'

/** Job lỗi tạm thời, đang chờ message quay lại queue (không phải chờ worker mới). */
export function isAwaitingRetry(job: Job): boolean {
  return job.status === 'queued' && job.attempts > 0 && Boolean(job.error_message)
}
