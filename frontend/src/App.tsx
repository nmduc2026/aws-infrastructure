import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AppLayout } from './components/layout/AppLayout'
import { ProtectedRoute, PublicRoute } from './components/layout/RouteGuards'
import { LoginPage } from './features/auth/LoginPage'
import { RegisterPage } from './features/auth/RegisterPage'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { LoadTestPage } from './features/load-test/LoadTestPage'
import { CreateJobPage } from './features/jobs/CreateJobPage'
import { JobDetailPage } from './features/jobs/JobDetailPage'
import { JobListPage } from './features/jobs/JobListPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="jobs" element={<JobListPage />} />
            <Route path="jobs/new" element={<CreateJobPage />} />
            <Route path="jobs/:ulid" element={<JobDetailPage />} />
            <Route path="load-test" element={<LoadTestPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
