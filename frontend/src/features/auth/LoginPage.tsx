import { App, Button, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthShell } from '../../components/layout/AuthShell'
import { ApiError } from '../../lib/api'
import { applyApiErrorsToForm } from '../../lib/formErrors'
import { useAuth } from '../../lib/auth'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<{ email: string; password: string }>()

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true)
    try {
      await login(values.email, values.password)
      message.success('Đăng nhập thành công')
      navigate('/')
    } catch (error) {
      if (error instanceof ApiError && error.errors) {
        applyApiErrorsToForm(form, error.errors)
      } else {
        message.error(error instanceof Error ? error.message : 'Đăng nhập thất bại')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell title="Đăng nhập" subtitle="Dùng tài khoản TaskFlow để quản lý job và worker.">
      <Form form={form} layout="vertical" onFinish={onFinish} size="large">
        <Form.Item
          name="email"
          label="Email"
          rules={[
            { required: true, message: 'Vui lòng nhập email' },
            { type: 'email', message: 'Email không hợp lệ' },
          ]}
        >
          <Input placeholder="you@example.com" />
        </Form.Item>
        <Form.Item
          name="password"
          label="Mật khẩu"
          rules={[{ required: true, message: 'Vui lòng nhập mật khẩu' }]}
        >
          <Input.Password />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          Đăng nhập
        </Button>
      </Form>
      <Typography.Paragraph style={{ marginTop: 20, marginBottom: 0, textAlign: 'center' }}>
        Chưa có tài khoản? <Link to="/register">Đăng ký</Link>
      </Typography.Paragraph>
    </AuthShell>
  )
}
