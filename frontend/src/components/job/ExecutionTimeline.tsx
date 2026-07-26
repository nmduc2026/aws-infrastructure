import { LoadingOutlined } from '@ant-design/icons'
import { Alert, Space, Tag, Timeline, Typography } from 'antd'
import dayjs from 'dayjs'
import { formatDuration } from '../../lib/format'
import type { JobExecution } from '../../types/job'

export function ExecutionTimeline({ executions }: { executions: JobExecution[] }) {
  const sorted = [...executions].sort((a, b) => b.attempt - a.attempt)

  if (!sorted.length) {
    return <Typography.Text type="secondary">Chưa có execution nào.</Typography.Text>
  }

  return (
    <Timeline
      mode="left"
      items={sorted.map((execution) => ({
        color:
          execution.status === 'completed'
            ? 'green'
            : execution.status === 'failed'
              ? 'red'
              : 'blue',
        dot: execution.status === 'running' ? <LoadingOutlined /> : undefined,
        children: (
          <>
            <Space>
              <Typography.Text strong>Attempt {execution.attempt}</Typography.Text>
              <Tag color={execution.status === 'failed' ? 'error' : 'success'}>
                {execution.status}
              </Tag>
            </Space>
            <div>
              <Typography.Text code type="secondary">
                {execution.worker_id}
              </Typography.Text>
            </div>
            {execution.error_message && (
              <Alert
                type="error"
                message={execution.error_message}
                style={{ marginTop: 8 }}
              />
            )}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {execution.status === 'running' && !execution.duration_ms
                ? 'đang chạy'
                : execution.duration_ms
                  ? formatDuration(execution.duration_ms)
                  : '—'}{' '}
              · {dayjs(execution.started_at).fromNow()}
            </Typography.Text>
          </>
        ),
      }))}
    />
  )
}
