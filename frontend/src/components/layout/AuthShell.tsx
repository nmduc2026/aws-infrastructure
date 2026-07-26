import { Card, Typography } from 'antd'
import type { ReactNode } from 'react'

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="auth-page">
      <Card
        className="auth-card"
        title={
          <div className="auth-card__brand">
            <div className="auth-card__logo">TF</div>
            TaskFlow
          </div>
        }
      >
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          {title}
        </Typography.Title>
        {subtitle && (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
            {subtitle}
          </Typography.Paragraph>
        )}
        {children}
      </Card>
    </div>
  )
}
