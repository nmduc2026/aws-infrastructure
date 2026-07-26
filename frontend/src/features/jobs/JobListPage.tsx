import { PlusOutlined } from '@ant-design/icons'
import { Button, Card, Empty, Progress, Result, Select, Space, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { JobDurationText, JobProgress } from '../../components/job/JobProgress'
import { JobStatusTag } from '../../components/job/JobStatusTag'
import { UlidText } from '../../components/job/UlidText'
import { PageHeader } from '../../components/layout/PageHeader'
import { JOB_TYPE_OPTIONS, STATUS_LABEL } from '../../theme'
import type { Job, JobStatus, JobType } from '../../types/job'
import { useJobs } from './hooks/useJobs'

const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}))

function parseStatus(value: string | null): JobStatus | undefined {
  if (!value) return undefined
  return value in STATUS_LABEL ? (value as JobStatus) : undefined
}

function parseType(value: string | null): JobType | undefined {
  if (!value) return undefined
  return JOB_TYPE_OPTIONS.some((option) => option.value === value)
    ? (value as JobType)
    : undefined
}

export function JobListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [status, setStatus] = useState<JobStatus | undefined>(() =>
    parseStatus(searchParams.get('status')),
  )
  const [type, setType] = useState<JobType | undefined>(() =>
    parseType(searchParams.get('type')),
  )
  const [page, setPage] = useState(() => Number(searchParams.get('page') || 1))

  useEffect(() => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (type) params.set('type', type)
    if (page > 1) params.set('page', String(page))
    setSearchParams(params, { replace: true })
  }, [status, type, page, setSearchParams])

  const { data, isLoading, isFetching, error, refetch } = useJobs({ status, type, page })

  const columns: ColumnsType<Job> = useMemo(
    () => [
      {
        title: 'ULID',
        dataIndex: 'ulid',
        render: (value: string) => <UlidText value={value} />,
      },
      { title: 'Type', dataIndex: 'type' },
      {
        title: 'Status',
        dataIndex: 'status',
        render: (value: JobStatus) => <JobStatusTag status={value} />,
      },
      {
        title: 'Progress',
        render: (_, record) => <JobProgress job={record} compact />,
      },
      {
        title: 'Created',
        render: (_, record) => <JobDurationText job={record} />,
      },
    ],
    [],
  )

  const jobs = data?.data ?? []
  const hasFilter = Boolean(status || type)

  const clearFilters = () => {
    setStatus(undefined)
    setType(undefined)
    setPage(1)
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <PageHeader
        title="Jobs"
        description="Tự làm mới khi còn job đang chạy."
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/jobs/new')}>
            Tạo job
          </Button>
        }
      />

      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear
            placeholder="Lọc theo status"
            style={{ width: 200 }}
            options={STATUS_OPTIONS}
            value={status}
            onChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
          />
          <Select
            allowClear
            placeholder="Lọc theo type"
            style={{ width: 200 }}
            options={[...JOB_TYPE_OPTIONS]}
            value={type}
            onChange={(value) => {
              setType(value)
              setPage(1)
            }}
          />
          {hasFilter && <Button onClick={clearFilters}>Xóa filter</Button>}
        </Space>

        {isFetching && !isLoading && (
          <Progress percent={100} status="active" showInfo={false} size="small" style={{ marginBottom: 8 }} />
        )}

        {error ? (
          <Result
            status="error"
            title="Không tải được danh sách job"
            subTitle={error instanceof Error ? error.message : 'Lỗi không xác định'}
            extra={
              <Button type="primary" onClick={() => void refetch()}>
                Thử lại
              </Button>
            }
          />
        ) : (
          <Table
            rowKey="ulid"
            columns={columns}
            dataSource={jobs}
            loading={isLoading}
            onRow={(record) => ({
              onClick: () => navigate(`/jobs/${record.ulid}`),
              style: { cursor: 'pointer' },
            })}
            locale={{
              emptyText: (
                <Empty
                  description={
                    hasFilter
                      ? 'Không có job nào khớp filter hiện tại'
                      : 'Chưa có job nào'
                  }
                >
                  {hasFilter ? (
                    <Button onClick={clearFilters}>Xóa filter</Button>
                  ) : (
                    <Button type="primary" onClick={() => navigate('/jobs/new')}>
                      Tạo job đầu tiên
                    </Button>
                  )}
                </Empty>
              ),
            }}
            pagination={{
              total: data?.meta.total,
              pageSize: data?.meta.per_page,
              current: data?.meta.current_page,
              showTotal: (total) => `${total} job`,
              onChange: (nextPage) => setPage(nextPage),
            }}
          />
        )}
      </Card>
    </Space>
  )
}
