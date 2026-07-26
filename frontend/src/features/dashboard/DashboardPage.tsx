import { Card, Col, List, Row, Statistic, Typography } from 'antd'
import { useNavigate } from 'react-router'
import { JobProgress } from '../../components/job/JobProgress'
import { JobStatusTag } from '../../components/job/JobStatusTag'
import { UlidText } from '../../components/job/UlidText'
import { PageHeader } from '../../components/layout/PageHeader'
import type { JobStatus } from '../../types/job'
import { useJobs, useSummary } from '../jobs/hooks/useJobs'

export function DashboardPage() {
  const navigate = useNavigate()
  const { data: summary, isLoading } = useSummary()
  const { data: recentJobs } = useJobs({ per_page: 10 })

  const goJobs = (status?: JobStatus) => {
    navigate(status ? `/jobs?status=${status}` : '/jobs')
  }

  const statCards: { title: string; value: number; status?: JobStatus }[] = [
    { title: 'Queued', value: summary?.queued ?? 0, status: 'queued' },
    { title: 'Processing', value: summary?.processing ?? 0, status: 'processing' },
    { title: 'Completed', value: summary?.completed ?? 0, status: 'completed' },
    { title: 'Failed', value: summary?.failed ?? 0, status: 'failed' },
    { title: 'Queue depth', value: summary?.queue_depth ?? 0, status: 'queued' },
  ]

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Tổng quan job và độ sâu queue — bấm thẻ để lọc danh sách."
      />

      <Row gutter={[16, 16]}>
        {statCards.map((card) => (
          <Col xs={24} sm={12} lg={6} key={card.title}>
            <Card loading={isLoading} hoverable onClick={() => goJobs(card.status)}>
              <Statistic title={card.title} value={card.value} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        title="Job gần đây"
        style={{ marginTop: 16 }}
        extra={
          <Typography.Link onClick={() => navigate('/jobs')}>Xem tất cả</Typography.Link>
        }
      >
        <List
          dataSource={recentJobs?.data ?? []}
          locale={{ emptyText: 'Chưa có job nào' }}
          renderItem={(job) => (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/jobs/${job.ulid}`)}
              actions={[<JobStatusTag key="status" status={job.status} />]}
            >
              <List.Item.Meta
                title={
                  <span>
                    <UlidText value={job.ulid} /> · {job.type}
                  </span>
                }
                description={<JobProgress job={job} compact />}
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  )
}
