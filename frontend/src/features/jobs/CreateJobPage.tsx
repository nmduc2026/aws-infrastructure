import { App, Button, Card, Form, Input, InputNumber, Select, Slider, Space, Switch, Typography } from 'antd'
import { useNavigate } from 'react-router'
import { PageHeader } from '../../components/layout/PageHeader'
import { ApiError } from '../../lib/api'
import { applyApiErrorsToForm } from '../../lib/formErrors'
import { createJobSchema } from '../../types/schemas'
import { JOB_TYPE_OPTIONS } from '../../theme'
import type { CreateJobBody } from '../../types/job'
import { buildCreateJobBody } from './buildCreateJobBody'
import { useCreateJob } from './hooks/useJobs'

type FormValues = {
  type: CreateJobBody['type']
  priority?: CreateJobBody['priority']
  payload: Record<string, unknown>
}

export function CreateJobPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const createJob = useCreateJob()
  const [form] = Form.useForm<FormValues>()
  const type = Form.useWatch('type', form) ?? 'simulate_work'

  const onFinish = (values: FormValues) => {
    const body = buildCreateJobBody(values)
    const parsed = createJobSchema.safeParse(body)

    if (!parsed.success) {
      message.error(parsed.error.issues[0]?.message ?? 'Dữ liệu form không hợp lệ')
      return
    }

    createJob.mutate(parsed.data, {
      onSuccess: (job) => {
        message.success('Đã tạo job')
        navigate(`/jobs/${job.ulid}`)
      },
      onError: (error) => {
        if (error instanceof ApiError && error.errors) {
          applyApiErrorsToForm(form, error.errors)
        } else {
          message.error(error instanceof Error ? error.message : 'Tạo job thất bại')
        }
      },
    })
  }

  return (
    <>
      <PageHeader title="Tạo job mới" />
      <Card>
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{
          type: 'simulate_work',
          priority: 'normal',
          payload: {
            duration_seconds: 10,
            failure_probability: 0,
            failure_type: 'retryable',
            record_count: 1000,
            format: 'csv',
            notify: true,
          },
        }}
      >
        <Form.Item name="type" label="Loại job" rules={[{ required: true }]}>
          <Select options={[...JOB_TYPE_OPTIONS]} />
        </Form.Item>

        <Form.Item name="priority" label="Priority">
          <Select
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
              { value: 'low', label: 'Low' },
            ]}
          />
        </Form.Item>

        {type === 'simulate_work' && (
          <>
            <Form.Item
              name={['payload', 'duration_seconds']}
              label="Thời gian (giây)"
              rules={[{ required: true, type: 'number', min: 1, max: 60 }]}
            >
              <InputNumber min={1} max={60} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name={['payload', 'failure_probability']} label="Tỷ lệ lỗi giả lập">
              <Slider min={0} max={1} step={0.05} marks={{ 0: '0%', 0.5: '50%', 1: '100%' }} />
            </Form.Item>
            <Form.Item name={['payload', 'failure_type']} label="Loại lỗi">
              <Select
                options={[
                  { value: 'retryable', label: 'Retryable' },
                  { value: 'non_retryable', label: 'Non-retryable' },
                ]}
              />
            </Form.Item>
          </>
        )}

        {type === 'generate_report' && (
          <>
            <Form.Item
              name={['payload', 'record_count']}
              label="Số bản ghi"
              rules={[{ required: true, type: 'number', min: 1, max: 100000 }]}
            >
              <InputNumber min={1} max={100000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name={['payload', 'format']} label="Định dạng">
              <Select options={[{ value: 'csv', label: 'CSV' }]} />
            </Form.Item>
          </>
        )}

        {type === 'send_email' && (
          <>
            <Form.Item
              name={['payload', 'to']}
              label="Email nhận"
              rules={[{ required: true, type: 'email' }]}
            >
              <Input />
            </Form.Item>
            <Form.Item name={['payload', 'subject']} label="Tiêu đề">
              <Input />
            </Form.Item>
            <Form.Item name={['payload', 'body']} label="Nội dung">
              <Input.TextArea rows={4} />
            </Form.Item>
          </>
        )}

        <Form.Item name={['payload', 'notify']} label="Gửi thông báo" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Space>
          <Button type="primary" htmlType="submit" loading={createJob.isPending}>
            Run
          </Button>
          <Button onClick={() => navigate('/jobs')}>Hủy</Button>
        </Space>
      </Form>

      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
        Chỉ gửi payload đúng với loại job đã chọn — không gửi field thừa của type khác.
      </Typography.Paragraph>
    </Card>
    </>
  )
}
