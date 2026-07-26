import { Typography } from 'antd'
import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  extra,
}: {
  title: string
  description?: string
  extra?: ReactNode
}) {
  return (
    <div className="page-header">
      <div className="page-header__text">
        <Typography.Title level={3} className="page-header__title">
          {title}
        </Typography.Title>
        {description && (
          <Typography.Paragraph type="secondary" className="page-header__desc">
            {description}
          </Typography.Paragraph>
        )}
      </div>
      {extra && <div className="page-header__extra">{extra}</div>}
    </div>
  )
}
