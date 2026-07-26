import { App, Alert, Button, Card, Form, InputNumber, Select, Slider, Space, Typography } from 'antd'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../../lib/api'
import { applyApiErrorsToForm } from '../../lib/formErrors'
import { useLoadTest } from '../jobs/hooks/useJobs'
import { LoadTestMonitor } from './LoadTestMonitor'
import { PageHeader } from '../../components/layout/PageHeader'

type LoadTestForm = {
  count: number
  duration_seconds: number
  failure_probability: number
  failure_type: 'retryable' | 'non_retryable'
}

export function LoadTestPage() {
  const { message } = App.useApp()
  const loadTest = useLoadTest()
  const [form] = Form.useForm<LoadTestForm>()
  const [monitor, setMonitor] = useState<{ created: number; job_ids: string[] } | null>(null)

  const count = Form.useWatch('count', form) ?? 10
  const duration = Form.useWatch('duration_seconds', form) ?? 10

  const estimate = useMemo(() => count * duration, [count, duration])

  const onFinish = (values: LoadTestForm) => {
    loadTest.mutate(values, {
      onSuccess: (result) => {
        message.success(`Đã tạo ${result.created} job`)
        setMonitor(result)
      },
      onError: (error) => {
        if (error instanceof ApiError && error.errors) {
          applyApiErrorsToForm(form, error.errors)
        } else {
          message.error(error instanceof Error ? error.message : 'Load test thất bại')
        }
      },
    })
  }

  return (
    <div>
      <PageHeader
        title="Load test"
        description="Tạo hàng loạt job simulate_work."
      />
      <Card>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 24 }}
          message="Auto scaling mất 2–4 phút để phản ứng"
          description="Bài test dưới 10 phút có thể kết thúc trước khi worker mới kịp khởi động. Ở Phase 1 local, worker chạy cố định trên máy bạn."
        />

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{
            count: 10,
            duration_seconds: 10,
            failure_probability: 0,
            failure_type: 'retryable',
          }}
        >
          <Form.Item
            name="count"
            label="Số lượng job"
            rules={[{ required: true, type: 'number', min: 1, max: 1000 }]}
          >
            <InputNumber min={1} max={1000} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="duration_seconds"
            label="Thời gian mỗi job (giây)"
            rules={[{ required: true, type: 'number', min: 1, max: 60 }]}
          >
            <InputNumber min={1} max={60} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="failure_probability" label="Tỷ lệ lỗi giả lập">
            <Slider min={0} max={1} step={0.05} marks={{ 0: '0%', 1: '100%' }} />
          </Form.Item>

          <Form.Item name="failure_type" label="Loại lỗi">
            <Select
              options={[
                { value: 'retryable', label: 'Retryable' },
                { value: 'non_retryable', label: 'Non-retryable' },
              ]}
            />
          </Form.Item>

          <Typography.Paragraph type="secondary">
            Ước tính: {count} job × {duration} giây = {estimate} giây công việc
            {estimate >= 600 && (
              <>
                {' '}
                (~{Math.round(estimate / 60)} phút
                {estimate >= 3600 ? `, ~${(estimate / 3600).toFixed(1)} giờ` : ''})
              </>
            )}
          </Typography.Paragraph>

          <Space>
            <Button type="primary" htmlType="submit" loading={loadTest.isPending}>
              Run
            </Button>
            {monitor && (
              <Link to="/jobs?status=queued">Mở danh sách job đang chờ</Link>
            )}
          </Space>
        </Form>
      </Card>

      {monitor && (
        <LoadTestMonitor jobIds={monitor.job_ids} totalCreated={monitor.created} />
      )}
    </div>
  )
}
