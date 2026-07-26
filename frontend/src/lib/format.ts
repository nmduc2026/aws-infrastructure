import dayjs from 'dayjs'
import type { Job } from '../types/job'

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.round(seconds % 60)
  return `${minutes}m ${remaining}s`
}

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return '—'
  return dayjs(value).fromNow()
}

export function waitedOver(job: Job, seconds: number): boolean {
  const anchor = job.queued_at ?? job.created_at
  if (!anchor) return false
  return dayjs().diff(dayjs(anchor), 'second') > seconds
}

export function formatJson(value: unknown): string {
  if (value == null) return '—'
  return JSON.stringify(value, null, 2)
}
