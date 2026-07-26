import { App, Button, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthShell } from '../../components/layout/AuthShell'
import { ApiError } from '../../lib/api'
import { applyApiErrorsToForm } from '../../lib/formErrors'
import { useAuth } from '../../lib/auth'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<{
    name: string
    email: string
    password: string
    password_confirmation: string
  }>()

  const onFinish = async (values: {
    name: string
    email: string
    password: string
    password_confirmation: string
  }) => {
    setLoading(true)
    try {
      await register(
        values.name,
        values.email,
        values.password,
        values.password_confirmation,
      )
      message.success('Đăng ký thành công')
      navigate('/')
    } catch (error) {
      if (error instanceof ApiError && error.errors) {
        applyApiErrorsToForm(form, error.errors)
      } else {
        message.error(error instanceof Error ? error.message : 'Đăng ký thất bại')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell title="Tạo tài khoản" subtitle="Bắt đầu tạo job và theo dõi worker trên môi trường local.">
      <Form form={form} layout="vertical" onFinish={onFinish} size="large">
        <Form.Item
          name="name"
          label="Tên"
          rules={[{ required: true, message: 'Vui lòng nhập tên' }]}
        >
          <Input placeholder="Tên hiển thị" />
        </Form.Item>
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
          rules={[{ required: true, message: 'Vui lòng nhập mật khẩu' }, { min: 8 }]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="password_confirmation"
          label="Xác nhận mật khẩu"
          dependencies={['password']}
          rules={[
            { required: true, message: 'Vui lòng xác nhận mật khẩu' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve()
                }
                return Promise.reject(new Error('Mật khẩu không khớp'))
              },
            }),
          ]}
        >
          <Input.Password />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          Đăng ký
        </Button>
      </Form>
      <Typography.Paragraph style={{ marginTop: 20, marginBottom: 0, textAlign: 'center' }}>
        Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
      </Typography.Paragraph>
    </AuthShell>
  )
}
