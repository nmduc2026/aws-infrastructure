import { Progress, Space, Spin, Typography } from 'antd'
import dayjs from 'dayjs'
import { formatRelativeTime } from '../../lib/format'
import { isAwaitingRetry } from '../../lib/jobUi'
import type { Job } from '../../types/job'

type JobProgressProps = {
  job: Job
  /** Bảng danh sách — chỉ icon / thanh, không kéo dài cột */
  compact?: boolean
}

export function JobProgress({ job, compact }: JobProgressProps) {
  if (job.status === 'queued') {
    if (isAwaitingRetry(job)) {
      if (compact) {
        return (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Chờ retry
          </Typography.Text>
        )
      }
      return (
        <Typography.Text type="secondary">
          Đang chờ lần chạy tiếp theo · {formatRelativeTime(job.queued_at)}
        </Typography.Text>
      )
    }

    if (compact) {
      return (
        <Space size={6}>
          <Spin size="small" />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Đang chờ
          </Typography.Text>
        </Space>
      )
    }

    return (
      <Space size={6}>
        <Spin size="small" />
        <Typography.Text type="secondary">
          Đang chờ worker · {formatRelativeTime(job.queued_at ?? job.created_at)}
        </Typography.Text>
      </Space>
    )
  }

  if (job.status === 'cancelling') {
    return (
      <Typography.Text type="warning" style={{ fontSize: compact ? 13 : undefined }}>
        Đang hủy…
      </Typography.Text>
    )
  }

  return (
    <Progress
      percent={job.progress}
      size="small"
      style={{ minWidth: compact ? 88 : 120, margin: 0 }}
      status={
        job.status === 'processing'
          ? 'active'
          : job.status === 'failed'
            ? 'exception'
            : 'success'
      }
    />
  )
}

export function JobDurationText({ job }: { job: Job }) {
  if (job.completed_at && job.started_at) {
    const ms = dayjs(job.completed_at).diff(dayjs(job.started_at))
    return <Typography.Text type="secondary">{Math.round(ms / 1000)}s</Typography.Text>
  }

  return <Typography.Text type="secondary">{formatRelativeTime(job.created_at)}</Typography.Text>
}
