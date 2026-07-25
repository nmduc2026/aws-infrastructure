# Frontend Guide — React Dashboard

Tài liệu này gom **toàn bộ phần frontend** của 8 phase vào một chỗ. Các file phase mô tả FE khá mỏng vì chúng tập trung vào AWS; đây là bản đầy đủ.

**Điểm khác biệt của dashboard này so với một CRUD app thông thường:** dữ liệu **luôn cũ**. Job được xử lý bởi worker ở nơi khác, có thể mất 2–4 phút mới bắt đầu chạy (do độ trễ auto scaling), và trạng thái chỉ cập nhật khi bạn hỏi lại. Gần như mọi quyết định thiết kế UI dưới đây đều xuất phát từ thực tế đó.

---

## 1. Quyết định stack

Repo hiện có React 19 + Vite 8 + TypeScript 6, chưa cài gì thêm. Bốn lựa chọn cần chốt:

| Vấn đề | Chọn | Vì sao |
|---|---|---|
| Routing | `react-router` v7 | Chuẩn de-facto, khai báo đơn giản |
| Data fetching | `@tanstack/react-query` | **Quan trọng nhất** — xem bên dưới |
| Form + validate | `react-hook-form` + `zod` | Zod dùng lại được để validate response API |
| Styling | CSS Modules + CSS variables | Không thêm build step, không config |
| Biểu đồ (Phase 4, 7) | `recharts` | API đơn giản, đủ cho line/area chart |

```bash
cd frontend
npm i react-router @tanstack/react-query react-hook-form zod @hookform/resolvers recharts
npm i -D @tanstack/react-query-devtools
```

### Vì sao TanStack Query chứ không phải `useEffect` + `fetch`

Ở [Phase 1](phase-1-local.md) tôi có viết một hook `usePolling` tự chế. Nó chạy được, nhưng với dashboard job thì bạn sẽ phải tự cài lại một loạt thứ mà Query đã có sẵn:

- **Polling có điều kiện** — `refetchInterval` nhận một hàm, nên có thể dừng poll khi mọi job đã ở trạng thái cuối.
- **Tự dừng khi tab ẩn** — `refetchIntervalInBackground: false`. Mở tab dashboard cả ngày mà không gọi API vô ích.
- **Cache chia sẻ** — trang danh sách và trang chi tiết dùng chung dữ liệu, không gọi 2 lần.
- **Invalidate sau mutation** — bấm Cancel xong tự refetch, không cần tự gọi lại.
- **Phân biệt `isLoading` và `isFetching`** — lần đầu hiện skeleton, các lần poll sau **không** nhấp nháy. Với UI polling 3 giây, đây là khác biệt giữa "mượt" và "khó chịu".

Cái cuối là lý do đủ mạnh rồi. Tự viết thì lần poll nào bảng cũng chớp trắng.

### Vì sao CSS Modules chứ không phải Tailwind

Dự án này có ~12 màn hình và mục tiêu là học AWS, không phải học CSS framework. CSS Modules + một bộ design token là **0 phút cấu hình** và không có gì để hỏng. Nếu bạn đã quen Tailwind thì cứ dùng — không ảnh hưởng gì tới phần còn lại của tài liệu.

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
├── components/                  # ===== DÙNG CHUNG — viết ở Phase 1 =====
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Table.tsx
│   │   ├── Badge.tsx
│   │   ├── Modal.tsx
│   │   ├── Toast.tsx
│   │   └── Skeleton.tsx
│   ├── job/
│   │   ├── JobStatusBadge.tsx   # dùng ở 6 màn hình khác nhau
│   │   ├── ProgressBar.tsx
│   │   ├── JobTypeIcon.tsx
│   │   └── ExecutionTimeline.tsx
│   ├── layout/
│   │   ├── AppShell.tsx         # sidebar + header
│   │   └── PageHeader.tsx
│   └── state/
│       ├── EmptyState.tsx
│       ├── ErrorState.tsx
│       └── LoadingState.tsx
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

---

## 3. Nền tảng (Phase 1)

### 3.1. Design token

`src/styles/tokens.css`:

```css
:root {
  /* Màu theo trạng thái — dùng nhất quán ở MỌI nơi */
  --status-queued:      #64748b;   /* xám  — đang chờ */
  --status-processing:  #0ea5e9;   /* xanh — đang chạy */
  --status-completed:   #10b981;   /* lục  — xong */
  --status-failed:      #ef4444;   /* đỏ   — hỏng */
  --status-cancelled:   #a1a1aa;   /* nhạt — người dùng hủy */
  --status-dead:        #b91c1c;   /* đỏ đậm — DLQ */

  --bg:        #ffffff;
  --bg-subtle: #f8fafc;
  --border:    #e2e8f0;
  --text:      #0f172a;
  --text-muted:#64748b;

  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;

  --radius: 8px;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a; --bg-subtle: #1e293b;
    --border: #334155; --text: #f1f5f9; --text-muted: #94a3b8;
  }
}
```

Bảng màu trạng thái là thứ bạn sẽ nhìn hàng nghìn lần trong 6 tháng. Chốt một lần, dùng ở mọi màn hình — badge, biểu đồ, timeline, thẻ thống kê.

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

Một schema dùng cho cả validate form lẫn suy ra TypeScript type (`z.infer`).

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

Modal xác nhận nêu rõ hệ quả: "Sẽ tạo message MỚI cho N job. Lịch sử execution cũ được giữ lại."

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
{job.status === 'queued' && (
  <div className={s.waiting}>
    <Spinner size="sm" />
    Đang chờ worker · {formatRelativeTime(job.queued_at)}
    {waitedOver(job, 120) && (
      <span className={s.hint}>Worker có thể đang khởi động (mất 2–4 phút)</span>
    )}
  </div>
)}
```

Dòng gợi ý sau 2 phút giúp bạn khỏi tưởng hệ thống hỏng — đúng vào lúc auto scaling đang khởi động task.

### 5.2. Nội suy progress giữa hai lần poll

Poll 3 giây một lần nhưng job cập nhật liên tục → progress bar nhảy giật. Cho CSS lo phần mượt:

```css
.fill {
  transition: width 3s linear;   /* khớp với chu kỳ poll */
}
```

Một dòng CSS, khác biệt lớn về cảm giác.

### 5.3. Cancel là "yêu cầu", không phải "lệnh"

Sau khi bấm Cancel, trạng thái là `cancelling` chứ không phải `cancelled`. Worker chỉ dừng ở checkpoint gần nhất. UI phải nói đúng điều đó:

```
● Đang hủy — chờ worker dừng ở checkpoint gần nhất
```

Đây là ví dụ điển hình của việc UI phải phản ánh trung thực giới hạn kỹ thuật (SQS không xóa được message cụ thể) thay vì giả vờ mọi thứ tức thời.

### 5.4. Phân biệt "đang tải lần đầu" và "đang làm mới"

```tsx
const { data, isLoading, isFetching } = useJobs(filters);

if (isLoading) return <TableSkeleton rows={10} />;   // lần đầu: skeleton

return (
  <>
    {isFetching && <div className={s.refreshBar} />}  {/* poll: thanh mảnh trên cùng */}
    <JobTable jobs={data.data} />
  </>
);
```

Không tách hai cái này thì cứ 3 giây bảng lại chớp trắng một lần.

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
- [ ] Cài router, react-query, react-hook-form, zod
- [ ] `lib/api.ts`, `lib/auth.tsx`, `lib/queryClient.ts`
- [ ] Design token với bảng màu trạng thái
- [ ] `AppShell` + sidebar
- [ ] Component dùng chung: Badge, ProgressBar, Table, EmptyState, Skeleton
- [ ] 6 màn hình Phase 1
- [ ] Polling dừng khi mọi job ở trạng thái cuối
- [ ] Polling dừng khi tab ẩn
- [ ] Bảng không chớp khi refetch

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
- **Component library (MUI, Ant, shadcn)** — 12 màn hình với ~10 component tự viết thì nhanh hơn là học API của một thư viện.
- **Storybook** — một người làm, không cần.
