import { ArrowLeftOutlined, ExclamationCircleOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Descriptions, Result, Space, Tabs, Typography } from 'antd'
import dayjs from 'dayjs'
import { useNavigate, useParams } from 'react-router'
import { ExecutionTimeline } from '../../components/job/ExecutionTimeline'
import { JsonViewer } from '../../components/job/JsonViewer'
import { JobProgress } from '../../components/job/JobProgress'
import { JobStatusTag } from '../../components/job/JobStatusTag'
import { isAwaitingRetry } from '../../lib/jobUi'
import { useCancelJob, useJob, useRetryJob } from './hooks/useJobs'

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'dead_lettered'])

export function JobDetailPage() {
  const { ulid = '' } = useParams()
  const navigate = useNavigate()
  const { modal, message } = App.useApp()
  const { data: job, isLoading, error } = useJob(ulid)
  const cancelJob = useCancelJob()
  const retryJob = useRetryJob()

  if (isLoading) {
    return <Card loading />
  }

  if (error || !job) {
    return (
      <Result
        status="error"
        title="Không tải được job"
        subTitle={error instanceof Error ? error.message : 'Job không tồn tại'}
        extra={<Button onClick={() => navigate('/jobs')}>Quay lại danh sách</Button>}
      />
    )
  }

  const canCancel = !TERMINAL.has(job.status) && job.status !== 'cancelling'
  // Khớp với guard phía API: chỉ retry được job đã ở trạng thái cuối.
  const canRetry =
    job.status === 'failed' || job.status === 'dead_lettered' || job.status === 'cancelled'
  const awaitingRetry = isAwaitingRetry(job)
  const failedExecutions = (job.executions ?? []).filter((e) => e.status === 'failed').length

  const confirmCancel = () => {
    modal.confirm({
      title: 'Hủy job này?',
      icon: <ExclamationCircleOutlined />,
      content:
        'Cancel chỉ đặt cờ trong DB. Worker sẽ dừng ở checkpoint gần nhất, không phải ngay lập tức.',
      okText: 'Hủy job',
      cancelText: 'Đóng',
      okButtonProps: { danger: true },
      onOk: () =>
        cancelJob.mutateAsync(ulid).then(() => {
          message.success('Đã gửi yêu cầu hủy')
        }),
    })
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div className="job-detail-toolbar">
        <Space align="center" wrap>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/jobs')}>
            Jobs
          </Button>
          <Typography.Text code style={{ fontSize: 15 }}>
            {job.ulid}
          </Typography.Text>
          <JobStatusTag status={job.status} />
        </Space>
        <Space wrap>
          <Button
            danger
            icon={<StopOutlined />}
            disabled={!canCancel}
            loading={cancelJob.isPending}
            onClick={confirmCancel}
          >
            Cancel
          </Button>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            disabled={!canRetry}
            loading={retryJob.isPending}
            onClick={() =>
              retryJob.mutate(ulid, {
                onSuccess: () => message.success('Đã gửi lại job'),
              })
            }
          >
            Retry
          </Button>
        </Space>
      </div>

      {awaitingRetry && (
        <Alert
          type="info"
          showIcon
          message="Đang chờ retry (backoff queue)"
          description={`Đã fail ${failedExecutions} lần. Worker chưa xử lý lại cho đến khi message được đẩy từ queue chờ.`}
        />
      )}

      {job.error_message && job.status === 'failed' && (
        <Alert type="error" showIcon message="Job thất bại" description={job.error_message} />
      )}

      <Card title="Tổng quan">
        <Descriptions
          bordered
          size="small"
          column={{ xs: 1, sm: 2 }}
          items={[
            { label: 'Status', children: <JobStatusTag status={job.status} /> },
            { label: 'Type', children: job.type },
            { label: 'Created', children: dayjs(job.created_at).format('DD/MM/YYYY HH:mm') },
            { label: 'Attempts', children: job.attempts },
            { label: 'Priority', children: job.priority },
            {
              label: 'Lỗi gần nhất',
              children: job.error_message ?? '—',
              span: 2,
            },
          ]}
        />
        <div style={{ marginTop: 20 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            Tiến độ
          </Typography.Text>
          <JobProgress job={job} />
        </div>
      </Card>

      <Card title="Lịch sử execution">
        <ExecutionTimeline executions={job.executions ?? []} />
      </Card>

      <Card>
        <Tabs
          items={[
            {
              key: 'payload',
              label: 'Payload',
              children: <JsonViewer value={job.payload_json} />,
            },
            {
              key: 'result',
              label: 'Result',
              children: <JsonViewer value={job.result_json} />,
            },
          ]}
        />
      </Card>
    </Space>
  )
}
