import { Card, Col, Progress, Row, Statistic, Typography } from 'antd'
import { useMemo } from 'react'
import { JobProgress } from '../../components/job/JobProgress'
import { JobStatusTag } from '../../components/job/JobStatusTag'
import { UlidText } from '../../components/job/UlidText'
import { TERMINAL_STATUSES } from '../../theme'
import type { Job } from '../../types/job'
import { useJobs, useSummary } from '../jobs/hooks/useJobs'

interface LoadTestMonitorProps {
  jobIds: string[]
  totalCreated: number
}

export function LoadTestMonitor({ jobIds, totalCreated }: LoadTestMonitorProps) {
  const { data: summary } = useSummary()
  const { data: jobsData } = useJobs({ per_page: 100 })

  const monitoredJobs = useMemo(() => {
    const idSet = new Set(jobIds)
    return (jobsData?.data ?? []).filter((job) => idSet.has(job.ulid))
  }, [jobsData, jobIds])

  const stats = useMemo(() => countByStatus(monitoredJobs), [monitoredJobs])
  const progressPercent =
    totalCreated > 0 ? Math.round((stats.completed / totalCreated) * 100) : 0
  const allDone =
    monitoredJobs.length > 0 &&
    monitoredJobs.every((job) => TERMINAL_STATUSES.includes(job.status))

  return (
    <Card title="Theo dõi load test" style={{ marginTop: 16 }}>
      <Typography.Paragraph type="secondary">
        Cập nhật realtime từ dashboard summary và danh sách job.
        {allDone ? ' Tất cả job đã ở trạng thái cuối.' : ' Đang poll mỗi 3–5 giây…'}
      </Typography.Paragraph>

      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} lg={4}>
          <Statistic title="Đã tạo" value={totalCreated} />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic title="Queued" value={stats.queued} />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic title="Processing" value={stats.processing} />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic title="Completed" value={stats.completed} />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic title="Failed" value={stats.failed} />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic title="Queue depth (hệ thống)" value={summary?.queue_depth ?? 0} />
        </Col>
      </Row>

      <div style={{ marginTop: 16 }}>
        <Typography.Text>Tiến độ batch: {stats.completed}/{totalCreated}</Typography.Text>
        <Progress percent={progressPercent} status={allDone ? 'success' : 'active'} />
      </div>

      <div style={{ marginTop: 16 }}>
        {monitoredJobs.slice(0, 8).map((job) => (
          <div
            key={job.ulid}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 0',
              borderBottom: '1px solid rgba(0,0,0,0.06)',
            }}
          >
            <span>
              <UlidText value={job.ulid} /> · {job.type}
            </span>
            <JobStatusTag status={job.status} />
            <div style={{ minWidth: 160 }}>
              <JobProgress job={job} />
            </div>
          </div>
        ))}
        {monitoredJobs.length > 8 && (
          <Typography.Text type="secondary">
            … và {monitoredJobs.length - 8} job khác (xem tại Jobs)
          </Typography.Text>
        )}
      </div>
    </Card>
  )
}

function countByStatus(jobs: Job[]) {
  return jobs.reduce(
    (acc, job) => {
      if (job.status === 'queued') acc.queued += 1
      else if (job.status === 'processing' || job.status === 'cancelling') acc.processing += 1
      else if (job.status === 'completed') acc.completed += 1
      else if (job.status === 'failed' || job.status === 'dead_lettered') acc.failed += 1
      return acc
    },
    { queued: 0, processing: 0, completed: 0, failed: 0 },
  )
}
