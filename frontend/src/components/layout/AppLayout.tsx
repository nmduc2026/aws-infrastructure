import {
  DashboardOutlined,
  ExperimentOutlined,
  LogoutOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { Avatar, Button, Layout, Menu, Typography } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../../lib/auth'

const { Sider, Content } = Layout

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/jobs', icon: <UnorderedListOutlined />, label: 'Jobs' },
  { key: '/load-test', icon: <ExperimentOutlined />, label: 'Load test' },
]

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const selectedKey =
    menuItems.find((item) =>
      item.key === '/'
        ? location.pathname === '/'
        : location.pathname.startsWith(item.key),
    )?.key ?? '/'

  const initials = user?.name
    ?.split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        className="app-sider"
        breakpoint="lg"
        collapsedWidth={0}
        width={220}
        theme="light"
        style={{ position: 'relative', paddingBottom: 72 }}
      >
        <div className="app-sider__brand">
          <div className="app-sider__logo">TF</div>
          <span>TaskFlow</span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none' }}
        />
        <div className="app-sider__footer">
          <div className="app-sider__user">
            <Avatar size={32} style={{ backgroundColor: '#1677ff', flexShrink: 0 }}>
              {initials || 'U'}
            </Avatar>
            <div className="app-sider__user-meta">
              <Typography.Text strong style={{ fontSize: 13 }}>
                {user?.name ?? 'User'}
              </Typography.Text>
              <span className="app-sider__email">{user?.email}</span>
            </div>
          </div>
          <Button
            type="text"
            block
            icon={<LogoutOutlined />}
            style={{ marginTop: 8, justifyContent: 'flex-start' }}
            onClick={() => {
              void logout().then(() => navigate('/login'))
            }}
          >
            Đăng xuất
          </Button>
        </div>
      </Sider>
      <Layout>
        <Content className="app-content">
          <div className="app-content__inner">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}
