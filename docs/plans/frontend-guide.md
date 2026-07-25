# Frontend Guide — React Dashboard

Tài liệu này gom **toàn bộ phần frontend** của 8 phase vào một chỗ. Các file phase mô tả FE khá mỏng vì chúng tập trung vào AWS; đây là bản đầy đủ.

**Điểm khác biệt của dashboard này so với một CRUD app thông thường:** dữ liệu **luôn cũ**. Job được xử lý bởi worker ở nơi khác, có thể mất 2–4 phút mới bắt đầu chạy (do độ trễ auto scaling), và trạng thái chỉ cập nhật khi bạn hỏi lại. Gần như mọi quyết định thiết kế UI dưới đây đều xuất phát từ thực tế đó.

---

## 1. Quyết định stack

Repo hiện có React 19 + Vite 8 + TypeScript 6, chưa cài gì thêm. Bốn lựa chọn cần chốt:

| Vấn đề | Chọn | Vì sao |
|---|---|---|
| Routing | `react-router` v7 | Chuẩn de-facto, khai báo đơn giản |
| Data fetching | `@tanstack/react-query` | **Quan trọng nhất** — xem 1.2 |
| **Component library** | **Ant Design v5** | **Được thiết kế đúng cho admin dashboard — xem 1.1** |
| Form + validate | `<Form>` của antd + `zod` | Form của antd đã tích hợp validate + layout |
| Biểu đồ (Phase 4, 7) | `recharts` | API đơn giản, đủ cho line/area chart |

```bash
cd frontend
npm i react-router @tanstack/react-query antd @ant-design/icons dayjs zod recharts
npm i -D @tanstack/react-query-devtools
```

Không cần cấu hình build gì thêm — antd v5 tree-shake sẵn, **không** cần `babel-plugin-import` như v4.

### 1.1. Vì sao Ant Design

> Bản trước của tài liệu này khuyên **không** dùng component library. Đó là lời khuyên sai cho dự án này: mục tiêu của bạn là học AWS, nên mọi giờ bỏ ra tự viết Modal hay Table đều là giờ lấy khỏi Phase 3–7.

Ant Design là thư viện duy nhất trong nhóm được thiết kế **chính xác cho admin dashboard nội bộ** — đúng thứ bạn đang làm. Bốn component quan trọng nhất của dự án đều có sẵn, miễn phí, **không cần package phụ nào**:

| Nhu cầu | Component antd | MUI | shadcn/ui |
|---|---|---|---|
| Bảng job sort/phân trang/chọn dòng | `<Table>` | cần `@mui/x-data-grid` | tự ghép TanStack Table (~200 dòng) |
| Timeline execution history | `<Timeline>` | cần `@mui/lab` | **không có**, tự viết |
| Toast thông báo | `message` / `notification` | **không có**, cần `notistack` | `sonner` |
| Modal xác nhận | `Modal.confirm()` | tự ghép `<Dialog>` | tự ghép `<AlertDialog>` |

Cộng thêm ba component "bonus" chỉ antd có, dùng được ngay:

- **`<Descriptions>`** — panel label/value. Đúng cho phần đầu trang `/jobs/:ulid` (Status · Type · Created · Attempts).
- **`<Statistic>`** — 4 thẻ số trên dashboard (Queued / Processing / Completed / Failed).
- **`<Result>`** — trang trạng thái rỗng/lỗi, có sẵn icon và layout.

`<Timeline>` là lý do mạnh nhất. Màn hình `/jobs/:ulid` với lịch sử execution là màn hình giá trị nhất của cả frontend (xem mục 4), và antd cho bạn nó gần như miễn phí.

**Ước tính: ~5–6 ngày cho 12 màn hình**, so với ~6–7 ngày với MUI và ~10–12 ngày với shadcn.

**Đánh đổi bạn đang chấp nhận:**
- Giao diện rất "Ant", khó tạo look riêng. Với dự án học AWS thì không phải vấn đề — có thể còn là ưu điểm vì trông chuyên nghiệp ngay từ đầu.
- CSS-in-JS runtime (`@ant-design/cssinjs`) có chi phí nhỏ. Không đáng kể ở quy mô này.
- API rất rộng — nhiều prop bạn sẽ không bao giờ dùng. Cứ bỏ qua, đừng cố đọc hết docs.
- Docs đôi khi dịch từ tiếng Trung hơi cứng, và một số GitHub issue bằng tiếng Trung.

**Mẹo khi mới dùng:** API của antd high-level, nên cách học nhanh nhất là mở trang component trên [ant.design/components](https://ant.design/components/overview) và copy đúng ví dụ gần nhất với nhu cầu. Đừng đọc hết bảng props — chỉ tra khi cần.

### 1.2. Vì sao TanStack Query chứ không phải `useEffect` + `fetch`

Ở [Phase 1](phase-1-local.md) tôi có viết một hook `usePolling` tự chế. Nó chạy được, nhưng với dashboard job thì bạn sẽ phải tự cài lại một loạt thứ mà Query đã có sẵn:

- **Polling có điều kiện** — `refetchInterval` nhận một hàm, nên có thể dừng poll khi mọi job đã ở trạng thái cuối.
- **Tự dừng khi tab ẩn** — `refetchIntervalInBackground: false`. Mở tab dashboard cả ngày mà không gọi API vô ích.
- **Cache chia sẻ** — trang danh sách và trang chi tiết dùng chung dữ liệu, không gọi 2 lần.
- **Invalidate sau mutation** — bấm Cancel xong tự refetch, không cần tự gọi lại.
- **Phân biệt `isLoading` và `isFetching`** — lần đầu hiện skeleton, các lần poll sau **không** nhấp nháy. Với UI polling 3 giây, đây là khác biệt giữa "mượt" và "khó chịu".

Cái cuối là lý do đủ mạnh rồi. Tự viết thì lần poll nào bảng cũng chớp trắng.

antd và TanStack Query **không chồng lấn**: antd lo giao diện, Query lo dữ liệu server. Nối với nhau qua `loading={isLoading}` và `dataSource={data}` là xong.

### 1.3. Setup ban đầu

`src/main.tsx`:

```tsx
import { ConfigProvider, App as AntApp, theme as antTheme } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { QueryClientProvider } from '@tanstack/react-query';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.locale('vi');
dayjs.extend(relativeTime);   // cho formatRelativeTime("2 phút trước")

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

createRoot(document.getElementById('root')!).render(
  <ConfigProvider
    locale={viVN}
    theme={{
      // Dark mode một dòng — antd tự sinh toàn bộ sắc độ
      algorithm: prefersDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      token: { borderRadius: 8, fontFamily: 'system-ui, sans-serif' },
    }}
  >
    {/* AntApp BẮT BUỘC: nó cấp context cho message/notification/Modal.confirm.
        Thiếu nó, gọi message.success() sẽ không hiện gì và cũng không báo lỗi. */}
    <AntApp>
      <QueryClientProvider client={queryClient}>
        <AppRoutes />
      </QueryClientProvider>
    </AntApp>
  </ConfigProvider>
);
```

> ⚠️ **Hai bẫy khi mới dùng antd v5:**
>
> 1. **Phải bọc `<App>` của antd** (đặt alias `AntApp` để không lẫn với component `App` của bạn). Không bọc thì `message.success()` im lặng không làm gì — rất khó debug vì không có lỗi nào.
> 2. **Dùng hook thay vì import trực tiếp.** `import { message } from 'antd'` rồi gọi `message.success()` sẽ mất theme và locale. Cách đúng:
>    ```tsx
>    const { message, modal, notification } = AntApp.useApp();
>    message.success('Đã tạo job');
>    ```
>
> Không cần import file CSS nào — antd v5 tự inject style.

---

## 2. Cấu trúc thư mục

Tổ chức theo **feature**, đúng với Nguyên tắc 7 (mỗi phase thêm feature mới, không sửa feature cũ):

```
frontend/src/
├── main.tsx
├── App.tsx                      # router + providers
│
├── lib/                         # ===== NỀN TẢNG — viết ở Phase 1, không sửa lại =====
│   ├── api.ts                   # HTTP client
│   ├── queryClient.ts           # cấu hình TanStack Query
│   ├── auth.tsx                 # AuthProvider + useAuth
│   └── format.ts                # formatDuration, formatRelativeTime, formatBytes
│
├── types/
│   ├── job.ts                   # Job, JobStatus, JobExecution
│   └── schemas.ts               # zod schema, dùng cho cả form lẫn validate response
│
├── theme.ts                     # bảng màu trạng thái + token antd
│
├── components/                  # ===== CHỈ những gì antd KHÔNG có =====
│   ├── job/
│   │   ├── JobStatusTag.tsx     # bọc <Tag> + map màu theo status
│   │   ├── JobProgress.tsx      # bọc <Progress> + xử lý trạng thái queued
│   │   ├── ExecutionTimeline.tsx# bọc <Timeline> của antd
│   │   └── UlidText.tsx         # <Typography.Text code copyable>
│   └── layout/
│       └── AppLayout.tsx        # <Layout> + <Menu> của antd
│
└── features/                    # ===== MỖI PHASE THÊM MỘT THƯ MỤC =====
    ├── auth/          # Phase 1
    ├── dashboard/     # Phase 1
    ├── jobs/          # Phase 1
    ├── load-test/     # Phase 1
    ├── dlq/           # Phase 2
    ├── workers/       # Phase 4
    ├── settings/      # Phase 5
    └── monitoring/    # Phase 7
```

Mỗi feature tự chứa:

```
features/jobs/
├── JobListPage.tsx
├── JobDetailPage.tsx
├── CreateJobPage.tsx
├── components/
│   ├── JobFilters.tsx
│   └── JobRow.tsx
└── hooks/
    └── useJobs.ts      # tất cả query/mutation liên quan job
```

Quy tắc: **feature không import từ feature khác.** Cần dùng chung thì đưa lên `components/` hoặc `lib/`. Đây là thứ giữ cho Phase 7 không phải sửa code Phase 1.

Chú ý thư mục `components/` **chỉ còn 5 file**, và tất cả đều là lớp bọc mỏng quanh component antd để gắn logic riêng của domain (map màu theo status, xử lý trạng thái `queued`). Không có `EmptyState`/`ErrorState` vì antd đã có `<Empty>` và `<Result>`. Đó chính là lợi ích của việc dùng thư viện.

---

## 3. Nền tảng (Phase 1)

### 3.1. Theme và bảng màu trạng thái

Với antd, spacing / radius / dark mode đã có sẵn qua `ConfigProvider`. Thứ duy nhất bạn cần khai báo là **bảng màu theo trạng thái job** — và nó phải khai báo **một lần, dùng ở mọi nơi**: tag, biểu đồ, timeline, thẻ thống kê.

`src/theme.ts`:

```ts
import type { JobStatus } from './types/job';

// Tên màu preset của antd. Dùng ở MỌI nơi cần <Tag> hoặc <Badge>.
// antd tự lo sắc độ cho light/dark nên không cần 2 bảng riêng.
export const STATUS_COLOR: Record<JobStatus, string> = {
  queued:        'default',
  processing:    'processing',   // preset đặc biệt: có animation nhấp nháy
  completed:     'success',
  failed:        'error',
  cancelling:    'warning',
  cancelled:     'default',
  dead_lettered: 'magenta',
};

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued:        'Đang chờ',
  processing:    'Đang chạy',
  completed:     'Hoàn thành',
  failed:        'Thất bại',
  cancelling:    'Đang hủy',
  cancelled:     'Đã hủy',
  dead_lettered: 'Dead letter',
};

// Mã hex cho Recharts (Phase 4, 7) — biểu đồ không đọc được token của antd
export const STATUS_HEX: Record<JobStatus, string> = {
  queued: '#8c8c8c', processing: '#1677ff', completed: '#52c41a',
  failed: '#ff4d4f', cancelling: '#faad14', cancelled: '#595959',
  dead_lettered: '#eb2f96',
};
```

> 💡 Preset `'processing'` của antd `<Tag>` có sẵn hiệu ứng nhấp nháy — đúng cho job đang chạy, không cần tự thêm animation.

`JobStatusTag` giờ chỉ còn 5 dòng:

```tsx
export function JobStatusTag({ status }: { status: JobStatus }) {
  return <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Tag>;
}
```

`STATUS_HEX` tồn tại riêng vì Recharts nhận màu dạng string. Giữ ba map đồng bộ — đổi màu thì đổi cả ba.

Nếu cần đọc token của antd trong code (ví dụ để tô màu biểu đồ theo theme hiện tại):

```tsx
const { token } = theme.useToken();   // token.colorSuccess, token.colorError, ...
```

### 3.1b. Bảng component — dùng gì cho việc gì

Tra bảng này thay vì tự viết:

| Nhu cầu | Component antd |
|---|---|
| Layout sidebar + header | `<Layout>` + `<Layout.Sider>` + `<Menu>` |
| Thẻ thống kê dashboard | `<Statistic>` trong `<Card>` |
| Bảng job sort/phân trang/chọn dòng | `<Table>` |
| Tag trạng thái | `<Tag color="processing">` |
| Progress bar | `<Progress percent={n}>` |
| Timeline execution | `<Timeline items={[...]}>` |
| Panel metadata (Status/Type/Created) | `<Descriptions>` |
| Skeleton lúc tải | `<Skeleton>` hoặc `<Table loading>` |
| Toast | `message.success()` qua `App.useApp()` |
| Modal xác nhận | `modal.confirm()` qua `App.useApp()` |
| Form + validate | `<Form>` + `<Form.Item rules={[...]}>` |
| Form input | `<Input> <InputNumber> <Select> <Slider> <Switch>` |
| JSON payload | `<Typography.Paragraph><pre>` hoặc `<Card>` |
| Tab trong trang chi tiết | `<Tabs items={[...]}>` |
| Copy ULID | `<Typography.Text code copyable>` |
| Tooltip giải thích | `<Tooltip>` |
| Cảnh báo trang load test | `<Alert type="warning" showIcon>` |
| Trạng thái rỗng | `<Empty>` |
| Trang lỗi | `<Result status="error">` |
| Nút có loading | `<Button loading={mutation.isPending}>` |

**Không có thứ nào phải tự viết.** Đó là điểm mạnh lớn nhất của antd cho dự án này — 5 file trong `components/` chỉ là lớp bọc gắn logic domain.

### 3.2. API client

`src/lib/api.ts`:

```ts
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api';

export class ApiError extends Error {
  constructor(public status: number, message: string, public errors?: Record<string, string[]>) {
    super(message);
  }
}

let token: string | null = localStorage.getItem('taskflow_token');

export function setToken(t: string | null) {
  token = t;
  t ? localStorage.setItem('taskflow_token', t) : localStorage.removeItem('taskflow_token');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401) {
    setToken(null);
    window.location.href = '/login';
    throw new ApiError(401, 'Phiên đăng nhập đã hết hạn');
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Laravel trả 422 kèm object errors — giữ nguyên để map vào form
    throw new ApiError(res.status, data.message ?? `HTTP ${res.status}`, data.errors);
  }

  return data;
}

export const api = {
  login:   (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me:      () => request<User>('/auth/me'),

  jobs:    (params: JobFilters) => request<Paginated<Job>>(`/jobs?${new URLSearchParams(params as any)}`),
  job:     (ulid: string) => request<JobDetail>(`/jobs/${ulid}`),
  createJob: (body: CreateJobBody) => request<Job>('/jobs', { method: 'POST', body: JSON.stringify(body) }),
  cancelJob: (ulid: string) => request<Job>(`/jobs/${ulid}/cancel`, { method: 'POST' }),
  retryJob:  (ulid: string) => request<Job>(`/jobs/${ulid}/retry`, { method: 'POST' }),

  summary: () => request<Summary>('/dashboard/summary'),
  loadTest:(body: LoadTestBody) => request<{ created: number }>('/load-tests', { method: 'POST', body: JSON.stringify(body) }),

  dlq:     () => request<Paginated<Job>>('/dlq'),                                    // Phase 2
  redrive: (ulid: string) => request<Job>(`/dlq/${ulid}/redrive`, { method: 'POST' }),
  workers: () => request<WorkerStatus>('/workers/status'),                           // Phase 4
  metrics: (range: string) => request<MetricSeries[]>(`/monitoring/metrics?range=${range}`), // Phase 7
};
```

### 3.3. Query client — cấu hình quyết định trải nghiệm

`src/lib/queryClient.ts`:

```ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      retry: (failureCount, error) => {
        // Không retry lỗi client — sai input thì thử lại vẫn sai
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,      // quay lại tab -> cập nhật ngay
      refetchIntervalInBackground: false, // tab ẩn -> NGỪNG poll
    },
  },
});
```

`refetchIntervalInBackground: false` là dòng tiết kiệm nhất trong toàn bộ frontend. Không có nó, một tab dashboard mở qua đêm sẽ gọi API 28.800 lần.

### 3.4. Hook cho job — trung tâm của mọi màn hình

`src/features/jobs/hooks/useJobs.ts`:

```ts
const TERMINAL: JobStatus[] = ['completed', 'failed', 'cancelled', 'dead_lettered'];

export function useJobs(filters: JobFilters) {
  return useQuery({
    queryKey: ['jobs', filters],
    queryFn: () => api.jobs(filters),

    // Poll 3 giây, nhưng DỪNG khi mọi job đã ở trạng thái cuối.
    // Không có điều kiện này, một dashboard toàn job completed vẫn gọi API mãi.
    refetchInterval: (query) => {
      const jobs = query.state.data?.data ?? [];
      const active = jobs.some(j => !TERMINAL.includes(j.status));
      return active ? 3_000 : false;
    },
  });
}

export function useJob(ulid: string) {
  return useQuery({
    queryKey: ['job', ulid],
    queryFn: () => api.job(ulid),
    refetchInterval: (query) =>
      query.state.data && TERMINAL.includes(query.state.data.status) ? false : 2_000,
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.cancelJob,

    // Optimistic update: đổi UI ngay, không chờ server.
    // Quan trọng vì cancel có độ trễ thật — worker chỉ dừng ở checkpoint gần nhất.
    onMutate: async (ulid) => {
      await qc.cancelQueries({ queryKey: ['job', ulid] });
      const prev = qc.getQueryData<JobDetail>(['job', ulid]);
      qc.setQueryData<JobDetail>(['job', ulid], (old) =>
        old ? { ...old, status: 'cancelling', cancel_requested: true } : old);
      return { prev };
    },
    onError: (_e, ulid, ctx) => { if (ctx?.prev) qc.setQueryData(['job', ulid], ctx.prev); },
    onSettled: (_d, _e, ulid) => {
      qc.invalidateQueries({ queryKey: ['job', ulid] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
```

---

## 4. Màn hình theo phase

### Phase 1 — 6 màn hình

#### `/login`
Form email + password. Lưu token, redirect `/`. Hiển thị lỗi 422 dưới từng field.

#### `/` — Dashboard

```
┌──────────────────────────────────────────────────────────┐
│  TaskFlow                                    [avatar]    │
├────────────┬─────────────────────────────────────────────┤
│ Dashboard  │  ┌────────┐┌────────┐┌────────┐┌────────┐  │
│ Jobs       │  │ Queued ││Process.││Complet.││ Failed │  │
│ Load Test  │  │   12   ││   3    ││  847   ││   14   │  │
│ DLQ     ●2 │  └────────┘└────────┘└────────┘└────────┘  │
│ Workers    │                                             │
│ Monitoring │  Queue depth (30 phút)                      │
│ Settings   │  ┌───────────────────────────────────────┐ │
│            │  │      ╱╲                                │ │
│            │  │    ╱    ╲___                           │ │
│            │  └───────────────────────────────────────┘ │
│            │                                             │
│            │  Job gần đây                                │
│            │  ┌───────────────────────────────────────┐ │
│            │  │ 01JAB… generate_report ● Processing   │ │
│            │  │        ███████░░░ 68%      2 phút     │ │
│            │  └───────────────────────────────────────┘ │
└────────────┴─────────────────────────────────────────────┘
```

Chấm đỏ `●2` cạnh mục DLQ trên sidebar là chi tiết nhỏ nhưng đáng làm — nó là thứ khiến bạn phát hiện job hỏng mà không phải chủ động đi tìm.

#### `/jobs` — Danh sách

Bảng: ULID (mono, click copy) · Type · Status badge · Progress · Duration · Created (thời gian tương đối). Filter theo status/type, phân trang.

Ba trạng thái rỗng khác nhau, đừng gộp làm một:
- Chưa có job nào → "Tạo job đầu tiên" + nút
- Có job nhưng filter không khớp → "Không có job nào ở trạng thái này" + nút xóa filter
- Lỗi tải → thông báo lỗi + nút thử lại

#### `/jobs/new` — Tạo job

Form động: chọn `job_type` trước, payload đổi theo type. Dùng zod discriminated union:

```ts
export const createJobSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('simulate_work'),
    payload: z.object({
      duration_seconds: z.number().int().min(1).max(60),
      failure_probability: z.number().min(0).max(1),
    }),
  }),
  z.object({
    type: z.literal('generate_report'),
    payload: z.object({
      record_count: z.number().int().min(1).max(100_000),
      format: z.enum(['csv', 'pdf']),
    }),
  }),
]);
```

Zod dùng để suy ra TypeScript type (`z.infer`) và validate response API. Còn **validate form thì dùng `rules` của antd** — nó tích hợp sẵn với layout và hiển thị lỗi:

```tsx
const [form] = Form.useForm();
const type = Form.useWatch('type', form);   // theo dõi field để đổi form động

<Form form={form} layout="vertical" onFinish={v => createJob.mutate(v)}
      initialValues={{ type: 'simulate_work', payload: { duration_seconds: 10 } }}>

  <Form.Item name="type" label="Loại job" rules={[{ required: true }]}>
    <Select options={JOB_TYPES} />
  </Form.Item>

  {type === 'simulate_work' && (
    <>
      <Form.Item name={['payload', 'duration_seconds']} label="Thời gian (giây)"
                 rules={[{ required: true, type: 'number', min: 1, max: 60 }]}>
        <InputNumber min={1} max={60} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item name={['payload', 'failure_probability']} label="Tỷ lệ lỗi giả lập">
        <Slider min={0} max={1} step={0.05}
                marks={{ 0: '0%', 0.5: '50%', 1: '100%' }} />
      </Form.Item>
    </>
  )}

  <Button type="primary" htmlType="submit" loading={createJob.isPending}>Run</Button>
</Form>
```

Hai điểm đáng chú ý:

- **`name={['payload', 'duration_seconds']}`** — antd hỗ trợ path dạng array cho field lồng nhau, nên payload lồng trong object không cần xử lý gì thêm.
- **`Form.useWatch`** — theo dõi giá trị một field mà không re-render cả form. Đây là cách đúng để làm form động theo `job_type`.

Sau khi submit thành công, map lỗi 422 từ Laravel vào form:

```tsx
onError: (err) => {
  if (err instanceof ApiError && err.errors) {
    form.setFields(Object.entries(err.errors).map(([name, errors]) => ({
      name: name.split('.'),    // Laravel trả "payload.duration_seconds"
      errors,
    })));
  }
}
```

#### `/jobs/:ulid` — Chi tiết (màn hình quan trọng nhất)

```
┌──────────────────────────────────────────────────────────┐
│ ← Jobs        01JABCXYZ            [Cancel]  [Retry]     │
├──────────────────────────────────────────────────────────┤
│ Status    ● Processing        Type    generate_report    │
│ Created   2 phút trước        Attempts 2                 │
│                                                          │
│ ████████████████░░░░░░░░  68%                            │
│                                                          │
│ ── Execution history ────────────────────────────────────│
│                                                          │
│  ● Attempt 2 · đang chạy      worker ip-10-0-1-42        │
│  │  bắt đầu 30 giây trước                                │
│  │                                                       │
│  ● Attempt 1 · thất bại       worker ip-10-0-2-11        │
│     Connection timeout after 30s                         │
│     chạy 30.2s · 3 phút trước                            │
│                                                          │
│ ── Payload ──────────────────────────────────────────────│
│  { "record_count": 10000, "format": "csv" }              │
└──────────────────────────────────────────────────────────┘
```

**Timeline execution là thứ có giá trị nhất của cả frontend.** Nó cho bạn thấy trực quan job đã bị nhận lại mấy lần, worker nào xử lý, lỗi gì ở từng lần. Đây chính là màn hình bạn sẽ nhìn suốt Phase 2 (kiểm chứng DLQ) và Phase 4 (kiểm chứng scale-in không mất job).

Với `<Timeline>` của antd, toàn bộ phần đó là ~20 dòng. API `items` (khuyến nghị từ v5.2, thay cho `<Timeline.Item>` cũ) nhận thẳng một mảng:

```tsx
<Timeline
  mode="left"
  items={executions.map(e => ({
    color: e.status === 'completed' ? 'green' : e.status === 'failed' ? 'red' : 'blue',
    dot: e.status === 'running' ? <LoadingOutlined /> : undefined,
    children: (
      <>
        <Space>
          <Typography.Text strong>Attempt {e.attempt}</Typography.Text>
          <Tag color={e.status === 'failed' ? 'error' : 'success'}>{e.status}</Tag>
        </Space>
        <Typography.Text code type="secondary">{e.worker_id}</Typography.Text>
        {e.error_message && (
          <Alert type="error" message={e.error_message} style={{ marginTop: 8 }} />
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {e.duration_ms ? formatDuration(e.duration_ms) : 'đang chạy'} · {dayjs(e.started_at).fromNow()}
        </Typography.Text>
      </>
    ),
  }))}
/>
```

Phần metadata phía trên dùng `<Descriptions>` — 8 dòng thay cho một grid tự làm:

```tsx
<Descriptions bordered size="small" column={2} items={[
  { label: 'Status',   children: <JobStatusTag status={job.status} /> },
  { label: 'Type',     children: job.type },
  { label: 'Created',  children: dayjs(job.created_at).fromNow() },
  { label: 'Attempts', children: job.attempts },
]} />
```

Khi job xong và có `result_s3_key`, hiện nút Download gọi pre-signed URL.

#### `/load-test`

Form: số lượng job · thời gian mỗi job · tỷ lệ lỗi · loại lỗi. Hiện trước ước tính:

```
500 job × 20 giây = 2.8 giờ công việc
Với 10 worker: ~17 phút
```

> ⚠️ Thêm một khối cảnh báo ngay trên nút Run, vì đây là hiểu nhầm phổ biến nhất ở Phase 4:
>
> *"Auto scaling mất 2–4 phút để phản ứng. Bài test dưới 10 phút sẽ kết thúc trước khi worker mới kịp khởi động."*

Sau khi chạy, chuyển sang màn hình theo dõi realtime với queue depth, số task, số job đã xong.

### Phase 2 — `/dlq`

Danh sách job `dead_lettered` với lỗi lần cuối. **Chọn nhiều + Redrive hàng loạt** — vì DLQ thường có 20 job cùng một nguyên nhân, redrive từng cái là vô nghĩa.

`<Table>` của antd có `rowSelection` sẵn, nên phần này gần như không phải viết:

```tsx
const [selected, setSelected] = useState<string[]>([]);
const { modal, message } = App.useApp();

<Table
  rowKey="ulid"
  dataSource={dlqJobs}
  loading={isLoading}
  rowSelection={{ selectedRowKeys: selected, onChange: k => setSelected(k as string[]) }}
  pagination={{ pageSize: 20, showTotal: t => `${t} job trong DLQ` }}
  columns={[
    { title: 'ULID', dataIndex: 'ulid',
      render: v => <Typography.Text code copyable>{v}</Typography.Text> },
    { title: 'Type', dataIndex: 'type', filters: JOB_TYPE_FILTERS,
      onFilter: (v, r) => r.type === v },
    { title: 'Lỗi lần cuối', dataIndex: 'error_message', ellipsis: true },
    { title: 'Thất bại lúc', dataIndex: 'failed_at', sorter: true,
      render: v => dayjs(v).fromNow() },
  ]}
/>

<Button type="primary" disabled={!selected.length} onClick={confirmRedrive}>
  Redrive {selected.length} job
</Button>
```

Chú ý `filters` + `onFilter` và `sorter` — antd lo toàn bộ phần sort và filter phía client, không cần viết state gì thêm. Đây là chỗ tiết kiệm nhiều nhất so với tự ghép TanStack Table.

Modal xác nhận dùng `modal.confirm()`, nêu rõ hệ quả:

```tsx
const confirmRedrive = () => modal.confirm({
  title: `Redrive ${selected.length} job?`,
  icon: <ExclamationCircleOutlined />,
  content: (
    <>Sẽ tạo message <b>MỚI</b> cho {selected.length} job.
       Lịch sử execution cũ được giữ lại để đối chiếu.</>
  ),
  okText: 'Redrive',
  cancelText: 'Hủy',
  onOk: async () => {
    await redrive.mutateAsync(selected);
    message.success(`Đã redrive ${selected.length} job`);
    setSelected([]);
  },
});
```

> 💡 `onOk` trả về Promise thì antd tự hiện loading trên nút OK và chỉ đóng modal khi resolve. Không phải tự quản lý state loading.

### Phase 4 — `/workers`

Màn hình đáng xem nhất sau khi có auto scaling:

```
┌──────────────────────────────────────────────────────────┐
│  Running tasks   Queue depth   In flight   Backlog/task  │
│       6              124           6            20.7     │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Queue depth ──── (trục trái)                      │ │
│  │  Running tasks ┄┄ (trục phải)                      │ │
│  │        ╱╲                                          │ │
│  │      ╱    ╲╲                                       │ │
│  │    ╱    ┄┄┄┄╲┄┄┄┄                                  │ │
│  │  ╱  ┄┄┄        ╲                                   │ │
│  └────────────────────────────────────────────────────┘ │
│  ↑ Chú ý khoảng trễ ~3 phút giữa queue tăng và task tăng│
└──────────────────────────────────────────────────────────┘
```

Hai đường chồng lên nhau trên hai trục Y (Recharts `<Line yAxisId="left">` và `<Line yAxisId="right">`). Khoảng trễ giữa chúng chính là bài học của Phase 4 — hiển thị được nó là hiểu được nó.

### Phase 5 — `/settings/notifications`

Bật/tắt email theo loại sự kiện. Bảng lịch sử email với trạng thái delivery (Sent / Delivered / Bounced / Complaint) dùng đúng bảng màu trạng thái ở mục 3.1.

Ghi rõ trên UI: *"SES đang ở sandbox — chỉ gửi được tới địa chỉ đã verify, tối đa 200 email/ngày."*

### Phase 7 — `/monitoring`

Metric từ CloudWatch qua API backend (`GetMetricData`), **không nhúng iframe console**. Thêm widget chi phí tháng hiện tại — widget bạn sẽ nhìn nhiều nhất trong 2 tháng cuối.

---

## 5. Bốn mẫu UX riêng của hệ thống bất đồng bộ

### 5.1. Đừng nói dối về tiến độ

Job vừa tạo ở trạng thái `queued` **chưa chạy gì cả**. Không hiện progress bar 0% đang animate — nó ngụ ý đang có việc diễn ra. Hiện chữ "Đang chờ worker" kèm thời gian chờ:

```tsx
{job.status === 'queued' ? (
  <Space>
    <Spin size="small" />
    <Typography.Text type="secondary">
      Đang chờ worker · {dayjs(job.queued_at).fromNow()}
    </Typography.Text>
    {waitedOver(job, 120) && (
      <Tooltip title="Auto scaling mất 2–4 phút để khởi động task mới">
        <Tag color="warning">Worker đang khởi động?</Tag>
      </Tooltip>
    )}
  </Space>
) : (
  <Progress
    percent={job.progress}
    status={job.status === 'processing' ? 'active'
          : job.status === 'failed' ? 'exception' : 'success'}
  />
)}
```

Tag gợi ý sau 2 phút giúp bạn khỏi tưởng hệ thống hỏng — đúng vào lúc auto scaling đang khởi động task.

`status="active"` của antd `<Progress>` có sẵn hiệu ứng sóng chạy, và `status="exception"` tự đổi sang màu đỏ kèm icon ✕. Không cần map màu thủ công.

### 5.2. Nội suy progress giữa hai lần poll

Poll 3 giây một lần nhưng job cập nhật liên tục → progress bar nhảy giật từng bước.

antd không có prop `transitionDuration`, nên override bằng CSS (một lần, trong `index.css`):

```css
/* Khớp với chu kỳ poll 3 giây -> thanh chạy đều thay vì nhảy */
.ant-progress-bg {
  transition: width 3s linear !important;
}
```

Một dòng CSS, khác biệt lớn về cảm giác. Đây là một trong rất ít chỗ phải can thiệp vào style của antd.

### 5.3. Cancel là "yêu cầu", không phải "lệnh"

Sau khi bấm Cancel, trạng thái là `cancelling` chứ không phải `cancelled`. Worker chỉ dừng ở checkpoint gần nhất. UI phải nói đúng điều đó:

```
● Đang hủy — chờ worker dừng ở checkpoint gần nhất
```

Đây là ví dụ điển hình của việc UI phải phản ánh trung thực giới hạn kỹ thuật (SQS không xóa được message cụ thể) thay vì giả vờ mọi thứ tức thời.

### 5.4. Phân biệt "đang tải lần đầu" và "đang làm mới"

`<Table>` có prop `loading` — nó hiện overlay mờ **giữ nguyên dữ liệu cũ** thay vì xóa trắng bảng, đúng hành vi ta cần. Nhưng phải truyền đúng biến:

```tsx
const { data, isLoading, isFetching } = useJobs(filters);

<Table
  rowKey="ulid"
  dataSource={data?.data ?? []}
  loading={isLoading}          // CHỈ lần đầu
  columns={columns}
/>

{/* Các lần poll sau: chỉ một thanh mảnh, không phủ overlay lên bảng */}
{isFetching && !isLoading && (
  <Progress percent={100} status="active" showInfo={false} size="small" />
)}
```

**Truyền `isFetching` vào `loading` là sai** — cứ 3 giây bảng lại bị phủ overlay và nhảy. Đây là lỗi rất dễ mắc vì hai biến tên gần giống nhau.

---

## 6. Deploy frontend — phần còn thiếu

Phase 1–7 chạy `npm run dev` là hoàn toàn ổn: nhanh, có HMR, và không tốn xu nào. Backend ở AWS, frontend ở local — không vấn đề gì.

**Phase 8** mới deploy thật, theo mô hình **S3 + CloudFront**.

> 💡 **Vì sao S3 + CloudFront:** React sau khi build chỉ là file tĩnh (HTML/CSS/JS). Không cần server chạy. S3 lưu file, CloudFront phân phối qua CDN và cung cấp HTTPS.
>
> **Chi phí: gần như $0.** S3 lưu ~2 MB = $0.00005/tháng. CloudFront miễn phí **1 TB dữ liệu ra + 10 triệu request mỗi tháng, vĩnh viễn**. Dashboard của bạn sẽ không bao giờ chạm tới giới hạn đó.
>
> **Vì sao cần CloudFront chứ không dùng S3 website endpoint:** S3 static website chỉ hỗ trợ **HTTP**, không có HTTPS. CloudFront cho phép gắn ACM certificate.

```hcl
resource "aws_s3_bucket" "frontend" {
  bucket = "taskflow-frontend-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# OAC: CloudFront truy cập S3 bằng danh tính có ký, bucket KHÔNG cần public.
# Đây là cách làm hiện tại, thay cho Origin Access Identity đã cũ.
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "taskflow-frontend-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"   # chỉ NA + EU, rẻ nhất

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6"  # Managed-CachingOptimized
  }

  # SPA routing: /jobs/01JABC không tồn tại trên S3.
  # Trả index.html để react-router xử lý phía client.
  # Thiếu phần này thì mọi URL ngoài "/" đều ra 403.
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions { geo_restriction { restriction_type = "none" } }
  viewer_certificate { cloudfront_default_certificate = true }
}
```

`scripts/deploy-frontend.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd frontend
VITE_API_URL=https://api.taskflow.example.com/api npm run build

aws s3 sync dist/ s3://taskflow-frontend-ACCOUNT_ID/ --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html" --profile taskflow

# index.html KHÔNG cache — nếu không, người dùng giữ bản cũ mãi
# và nó sẽ trỏ tới file JS có hash cũ đã bị xóa.
aws s3 cp dist/index.html s3://taskflow-frontend-ACCOUNT_ID/index.html \
  --cache-control "no-cache,no-store,must-revalidate" --profile taskflow

aws cloudfront create-invalidation \
  --distribution-id $DIST_ID --paths "/index.html" --profile taskflow
```

> ⚠️ Chiến lược cache hai tầng ở trên là chuẩn cho SPA có hash trong tên file: asset cache 1 năm (tên đổi khi nội dung đổi), `index.html` không cache bao giờ. Làm ngược lại là lỗi deploy kinh điển — người dùng thấy trang trắng vì `index.html` cũ trỏ tới bundle đã bị xóa.

### CORS

Frontend ở `d123.cloudfront.net`, API ở `api.example.com` → khác origin. Cấu hình `backend/config/cors.php`:

```php
'paths' => ['api/*'],
'allowed_methods' => ['*'],
'allowed_origins' => [env('FRONTEND_URL')],   // KHÔNG dùng '*' khi có Authorization header
'allowed_headers' => ['*'],
'supports_credentials' => false,               // dùng token, không dùng cookie
```

Vì đã chọn **token-based auth** (không phải cookie), CORS ở đây rất đơn giản — không cần `supports_credentials`, không cần cấu hình `SANCTUM_STATEFUL_DOMAINS`. Đây là phần thưởng cho quyết định ở Phase 1.

---

## 7. Checklist frontend theo phase

**Phase 1**
- [ ] Cài antd + router + react-query + zod + dayjs
- [ ] `ConfigProvider` + **`<App>` của antd** (thiếu là `message` im lặng) + `QueryClientProvider`
- [ ] `dayjs.extend(relativeTime)` + locale `vi`
- [ ] Dùng `App.useApp()` để lấy `message`/`modal`, **không** import trực tiếp từ `antd`
- [ ] `theme.ts` với `STATUS_COLOR` / `STATUS_LABEL` / `STATUS_HEX`
- [ ] `lib/api.ts`, `lib/auth.tsx`, `lib/queryClient.ts`
- [ ] `AppLayout` (`<Layout>` + `<Menu>`) + badge số DLQ trên nav
- [ ] 4 component bọc: `JobStatusTag`, `JobProgress`, `ExecutionTimeline`, `UlidText`
- [ ] 6 màn hình Phase 1
- [ ] Polling dừng khi mọi job ở trạng thái cuối
- [ ] Polling dừng khi tab ẩn
- [ ] `<Table loading={isLoading}>` — **không** truyền `isFetching`
- [ ] CSS override `.ant-progress-bg { transition: width 3s linear }`
- [ ] Map lỗi 422 của Laravel vào `form.setFields()`

**Phase 2** — [ ] `/dlq` với redrive hàng loạt · [ ] chấm đỏ trên sidebar

**Phase 4** — [ ] `/workers` với biểu đồ 2 trục · [ ] cảnh báo độ trễ trên trang load test

**Phase 5** — [ ] `/settings/notifications` · [ ] bảng trạng thái email

**Phase 7** — [ ] `/monitoring` · [ ] widget chi phí tháng

**Phase 8** — [ ] Build và deploy S3 + CloudFront · [ ] SPA fallback 403/404 → index.html · [ ] cache 2 tầng · [ ] CORS

---

## 8. Thứ KHÔNG làm

- **WebSocket / realtime** — polling 3 giây là đủ cho job chạy 5–30 giây. WebSocket cần API Gateway WebSocket hoặc server riêng, tốn tiền và tốn thời gian.
- **SSR / Next.js** — dashboard sau đăng nhập, không cần SEO, không cần server render.
- **Redux / Zustand** — TanStack Query đã lo server state; UI state cục bộ dùng `useState` là đủ. Dự án này gần như không có global client state.
- **Tự viết component library** — đây là điều bản đầu của tài liệu khuyên sai. Tự viết Modal / Table / Timeline tốn 3–4 ngày, mà thời gian đó nên dành cho Phase 3–7. Dùng antd (mục 1.1).
- **Tailwind hoặc CSS framework khác song song với antd** — chọn một. Dùng cả hai là hai hệ thống spacing/màu chồng nhau, tốn thời gian đối chiếu hơn là tiết kiệm.
- **Thư viện icon khác** — `@ant-design/icons` là đủ, import theo tên nên tree-shake tốt. Không cần Font Awesome hay Lucide.
- **`@ant-design/pro-components`** — bộ "pro" của antd (ProTable, ProForm) rất mạnh nhưng thêm một tầng abstraction nữa phải học, và nó giả định pattern fetch data riêng — sẽ xung đột với TanStack Query. `<Table>` thường là đủ.
- **Cố tạo look riêng cho antd** — chỉnh `token` trong `ConfigProvider` là đủ (borderRadius, colorPrimary). Đừng override CSS sâu; đó là hố thời gian không đáy và bạn đang học AWS.
- **Storybook** — một người làm, không cần.
