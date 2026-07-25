# Phase 2 — Amazon SQS thật

**Mục tiêu:** thay `DatabaseJobQueue` bằng SQS thật. Worker vẫn chạy local.
**Thời gian:** 1 tuần
**Chi phí:** < $1 (1 triệu request/tháng miễn phí vĩnh viễn)
**Kết quả:** hiểu vòng đời message SQS bằng tay, trước khi tự động hóa mọi thứ ở Phase 3.

---

## 2.0. SQS là gì

> 💡 **Giải thích:** Amazon SQS (Simple Queue Service) là một hàng đợi message được AWS quản lý. Bạn `SendMessage` vào, một chương trình khác `ReceiveMessage` ra. AWS lo phần khó: dữ liệu được sao lưu trên nhiều máy chủ, chịu được sập máy, và mở rộng vô hạn mà bạn không phải làm gì.
>
> **Vì sao cần queue:** nếu Laravel xử lý báo cáo 30 giây ngay trong HTTP request thì request timeout, người dùng chờ, và không scale được. Queue tách rời "nhận yêu cầu" (nhanh, trả 202 ngay) khỏi "làm việc" (chậm, chạy nền, có thể thêm worker khi bận).
>
> **Điểm khác biệt cốt lõi so với một bảng database:** SQS **không xóa** message khi bạn nhận nó — chỉ **giấu đi** trong `visibility timeout` giây. Worker chết giữa chừng → message tự hiện lại → worker khác nhận. Bạn không mất job mà không cần viết một dòng code retry nào.

**Standard Queue** (ta dùng): thông lượng gần như vô hạn, **có thể giao trùng** và **không đảm bảo thứ tự**. Đó là lý do worker phải idempotent — đã làm ở Phase 1.

**FIFO Queue**: đúng thứ tự, không trùng, nhưng chậm hơn và đắt hơn. Chưa cần.

Bạn đã mô phỏng toàn bộ ngữ nghĩa này ở Phase 1 với `DatabaseJobQueue`, nên phase này chủ yếu là **xác nhận hiểu đúng** và đổi một dòng config.

---

## 2.1. Tạo queue bằng console (làm bằng tay lần đầu)

Phase 3 sẽ chuyển sang Terraform. Lần này làm bằng tay để nhìn thấy từng tùy chọn.

### Bước 1 — Tạo DLQ trước

> 💡 **Vì sao DLQ trước:** queue chính cần trỏ tới ARN của DLQ, nên DLQ phải tồn tại trước.
>
> **DLQ (Dead Letter Queue) là gì:** một queue thường, nhưng dùng làm nơi chứa message "chết" — message đã được giao quá số lần cho phép mà worker vẫn không xử lý xong. Không có DLQ thì message lỗi sẽ quay vòng vô hạn, chiếm chỗ và làm nhiễu metric.

**Console → SQS → Create queue:**

```
Type                    : Standard
Name                    : taskflow-jobs-dlq
Visibility timeout      : 30 giây
Message retention period: 14 days        ← tối đa, để có thời gian điều tra
Receive message wait    : 20 giây
```

Tạo xong, copy **ARN** (dạng `arn:aws:sqs:us-east-1:123456789012:taskflow-jobs-dlq`).

### Bước 2 — Tạo queue chính

```
Type                    : Standard
Name                    : taskflow-jobs
Visibility timeout      : 180 giây
Message retention period: 4 days
Delivery delay          : 0
Receive message wait    : 20 giây        ← long polling, xem giải thích bên dưới
Maximum message size    : 256 KB
```

Phần **Dead-letter queue** ở dưới:

```
Set this queue to receive undeliverable messages : Enabled
Dead-letter queue                                 : (chọn ARN của taskflow-jobs-dlq)
Maximum receives                                  : 3
```

> 💡 **Giải thích 3 tham số quan trọng nhất:**
>
> **Visibility timeout = 180s** — sau khi worker nhận message, nó bị giấu 180 giây. Phải **lớn hơn** thời gian xử lý (worker timeout của ta là 150s). Nếu đặt bằng nhau, đúng lúc worker sắp xong thì message đã hiện lại và worker thứ hai nhận cùng job.
>
> **Receive message wait = 20s (long polling)** — khi queue rỗng, `ReceiveMessage` sẽ *chờ* tới 20 giây xem có message mới không, thay vì trả về rỗng ngay lập tức. Không bật thì worker gọi API hàng nghìn lần mỗi phút một cách vô nghĩa (short polling). Đây là mặc định sai của AWS mà bạn **luôn** phải sửa.
>
> **Maximum receives = 3** — message được giao tối đa 3 lần. Lần thứ 4 SQS tự chuyển sang DLQ. Chú ý: đếm theo *số lần giao*, không phải *số lần thất bại* — worker crash trước khi kịp làm gì cũng tính là một lần.

### Bước 3 — Tạo queue notifications

Tạo thêm `taskflow-notifications-dlq` rồi `taskflow-notifications`:

```
Name              : taskflow-notifications
Visibility timeout: 60 giây          ← >= 6x timeout của Lambda (Phase 6)
DLQ               : taskflow-notifications-dlq, maxReceives = 3
```

Phase 6 mới dùng, nhưng tạo luôn cho đủ bộ.

---

## 2.2. Cấp quyền cho Laravel local

Tạo IAM user `taskflow-app-local` (Console → IAM → Users → Create user, **không** cần console access):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendJobsOnly",
      "Effect": "Allow",
      "Action": ["sqs:SendMessage", "sqs:GetQueueUrl", "sqs:GetQueueAttributes"],
      "Resource": "arn:aws:sqs:us-east-1:ACCOUNT_ID:taskflow-jobs"
    },
    {
      "Sid": "WorkerConsume",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage", "sqs:DeleteMessage",
        "sqs:ChangeMessageVisibility", "sqs:GetQueueUrl", "sqs:GetQueueAttributes"
      ],
      "Resource": [
        "arn:aws:sqs:us-east-1:ACCOUNT_ID:taskflow-jobs",
        "arn:aws:sqs:us-east-1:ACCOUNT_ID:taskflow-jobs-dlq"
      ]
    }
  ]
}
```

> 💡 Ở Phase 2, worker vẫn chạy local nên phải dùng chung access key này. Từ Phase 3, worker chạy trên ECS và dùng **IAM Role** — không còn access key nào nữa, và lúc đó ta sẽ tách quyền gửi/nhận ra hai role khác nhau. Ghi chú lại để nhớ quay lại thu hẹp quyền.

Tạo access key, thêm vào `backend/.env`:

```dotenv
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012
```

---

## 2.3. Cài `SqsJobQueue`

```bash
cd backend
composer require aws/aws-sdk-php
```

`app/Queue/SqsJobQueue.php`:

```php
final class SqsJobQueue implements JobQueue
{
    private SqsClient $sqs;
    private array $urlCache = [];

    public function __construct()
    {
        $this->sqs = new SqsClient([
            'version' => 'latest',
            'region'  => config('taskflow.aws.region'),
            // Không truyền credentials: SDK tự tìm theo thứ tự
            //   env vars -> ~/.aws/credentials -> IAM Role của ECS task (Phase 3)
            // Nhờ vậy code này chạy y nguyên ở local lẫn trên ECS.
        ]);
    }

    private function url(string $queue): string
    {
        return $this->urlCache[$queue] ??= sprintf(
            'https://sqs.%s.amazonaws.com/%s/%s',
            config('taskflow.aws.region'),
            config('taskflow.aws.account_id'),
            $queue,
        );
    }

    public function send(string $queue, JobMessage $message): void
    {
        $this->sqs->sendMessage([
            'QueueUrl'    => $this->url($queue),
            'MessageBody' => json_encode($message),
        ]);
    }

    public function receive(string $queue, int $waitSeconds = 20): ?ReceivedMessage
    {
        $result = $this->sqs->receiveMessage([
            'QueueUrl'            => $this->url($queue),
            'MaxNumberOfMessages' => 1,
            'WaitTimeSeconds'     => $waitSeconds,      // long polling
            'VisibilityTimeout'   => config('taskflow.visibility_timeout'),
            'AttributeNames'      => ['ApproximateReceiveCount'],
        ]);

        $messages = $result['Messages'] ?? [];
        if (empty($messages)) {
            return null;
        }

        $m = $messages[0];

        return new ReceivedMessage(
            receiptHandle: $m['ReceiptHandle'],
            // SQS TỰ đếm số lần giao. Ta không phải quản lý gì —
            // khác hẳn DatabaseJobQueue phải tự tăng receive_count.
            receiveCount:  (int) ($m['Attributes']['ApproximateReceiveCount'] ?? 1),
            body:          json_decode($m['Body'], true),
        );
    }

    public function delete(string $queue, ReceivedMessage $message): void
    {
        $this->sqs->deleteMessage([
            'QueueUrl'      => $this->url($queue),
            'ReceiptHandle' => $message->receiptHandle,
        ]);
    }

    public function changeVisibility(string $queue, ReceivedMessage $message, int $seconds): void
    {
        $this->sqs->changeMessageVisibility([
            'QueueUrl'          => $this->url($queue),
            'ReceiptHandle'     => $message->receiptHandle,
            'VisibilityTimeout' => $seconds,     // ĐẶT LẠI tính từ bây giờ, không cộng dồn
        ]);
    }

    public function approximateSize(string $queue): int
    {
        $r = $this->sqs->getQueueAttributes([
            'QueueUrl'       => $this->url($queue),
            'AttributeNames' => ['ApproximateNumberOfMessages'],
        ]);
        return (int) ($r['Attributes']['ApproximateNumberOfMessages'] ?? 0);
    }
}
```

**So sánh với `DatabaseJobQueue`:** cùng interface, cùng ngữ nghĩa, nhưng ngắn hơn nhiều — vì SQS làm hộ phần khó (row lock, đếm receive, redrive, độ bền dữ liệu). Đó chính là giá trị của managed service.

---

## 2.4. Chuyển đổi

Sửa **một dòng** trong `backend/.env`:

```dotenv
TASKFLOW_QUEUE_DRIVER=sqs
```

```bash
php artisan config:clear
php artisan taskflow:consume
```

Không sửa `JobProcessor`, không sửa handler, không sửa controller, không sửa React. Đây là phần thưởng cho công sức bỏ ra ở Nguyên tắc 2.

---

## 2.5. Bảy thí nghiệm bắt buộc

Đây mới là nội dung chính của Phase 2. Làm bằng tay, quan sát trên console.

### Thí nghiệm 1 — Message trông như thế nào

Tạo 1 job từ UI, **đừng chạy worker**. Vào **SQS → taskflow-jobs → Send and receive messages → Poll for messages**.

Bạn thấy message với đầy đủ body JSON và các attribute. Nhấn vào xem `ApproximateReceiveCount`.

> ⚠️ **Quan trọng:** chính việc bạn poll bằng console cũng là một lần "nhận"! `ApproximateReceiveCount` vừa tăng lên 1. Poll 3 lần bằng console là message vào DLQ mà chẳng có worker nào chạm vào. Đây là điều rất nhiều người bối rối lần đầu.

### Thí nghiệm 2 — Visibility timeout

1. Chạy worker với job 60 giây.
2. Trong lúc chạy, mở console xem queue.
3. **Messages available = 0**, **Messages in flight = 1**.

> 💡 "In flight" = đã giao cho ai đó nhưng chưa bị xóa, đang trong visibility timeout. Đây chính là `visible_at` trong bảng mô phỏng ở Phase 1.

### Thí nghiệm 3 — Worker chết giữa chừng

1. Tạo job 60 giây, chạy worker.
2. Sau 10 giây, đóng cứng terminal worker (không Ctrl+C nhẹ nhàng).
3. Xem queue: vẫn "in flight".
4. **Chờ 180 giây.** Message quay lại "available".
5. Chạy worker mới → nó nhận lại job với `ApproximateReceiveCount = 2`.

Đây là lý do tồn tại của visibility timeout. Không có dòng code retry nào, mà job vẫn không mất.

### Thí nghiệm 4 — DLQ

Tạo job `failure_probability = 1.0`, `failure_type = retryable`. Chạy worker và chờ.

Với backoff 30s/120s/300s, tổng khoảng 8 phút. Quan sát:

| Thời điểm | `taskflow-jobs` | `taskflow-jobs-dlq` |
|---|---|---|
| t=0 | 1 available | 0 |
| t=1s | 1 in flight (receive 1) | 0 |
| t=31s | 1 in flight (receive 2) | 0 |
| t=151s | 1 in flight (receive 3) | 0 |
| t=451s | 0 | **1** |

Kiểm tra `job_executions`: đúng 3 dòng.

Muốn test nhanh: đặt tạm `TASKFLOW_VISIBILITY_TIMEOUT=10` (nhớ đổi cả trên console queue) và sửa `backoffSeconds` trả về 5.

### Thí nghiệm 5 — Redrive bằng console

**SQS → taskflow-jobs-dlq → Start DLQ redrive → Redrive to source queue.**

Message quay về `taskflow-jobs` với `ApproximateReceiveCount` reset về 0.

> 💡 Đây là công cụ vận hành thật: sau khi sửa bug, bạn redrive toàn bộ message trong DLQ để chạy lại. Phase 6 sẽ tự động hóa một phần việc này.

### Thí nghiệm 6 — Lỗi vĩnh viễn

`failure_type = non_retryable` → message bị xóa ngay sau lần 1, **không** vào DLQ, `job_executions` có đúng 1 dòng.

Nếu bạn thấy nó vào DLQ, tức là `NonRetryableException` chưa được bắt đúng chỗ trong `JobProcessor`.

### Thí nghiệm 7 — Giao trùng của Standard Queue

Chạy **3 worker** cùng lúc, tạo 50 job. Kiểm tra:

```sql
SELECT j.ulid, COUNT(*) AS n
FROM job_executions e JOIN jobs j ON j.id = e.job_id
GROUP BY j.ulid HAVING n > 1;
```

Có thể có vài job xuất hiện 2 lần — **đó là bình thường với Standard Queue**. Điều quan trọng là kiểm tra chúng không bị xử lý *đồng thời*: log phải có `job.already_claimed`, và `result_json` chỉ được ghi một lần.

Đây là bằng chứng compare-and-set ở Phase 1 hoạt động trên môi trường thật.

---

## 2.6. Thêm trang DLQ vào React

Route mới `/dlq` (Nguyên tắc 7 — chỉ thêm, không sửa trang cũ):

- Danh sách job có `status = 'dead_lettered'` hoặc có ≥ 3 execution thất bại.
- Hiển thị `error_message` của lần thử cuối.
- Nút **Redrive** gọi `POST /api/dlq/{ulid}/redrive`.

Backend `DlqController::redrive` đơn giản là gọi lại `JobDispatcher::redispatch()` — gửi message mới, không hồi sinh message cũ.

Thêm vào `/dashboard/summary` số message trong DLQ (dùng `approximateSize('taskflow-jobs-dlq')`).

---

## 2.7. Chi phí phase này

| Hạng mục | Lượng dùng | Chi phí |
|---|---|---:|
| SQS request | ~50k/tháng | $0 (1M miễn phí) |
| Data transfer | vài MB | $0 |

Thực tế **$0**. Nhưng lưu ý: **long polling giúp bạn ở trong free tier**. Nếu quên bật (`WaitTimeSeconds=0`), một worker rảnh sẽ gọi ~100 request/giây = 250 triệu request/tháng = **$100**. Đây là bẫy chi phí duy nhất của Phase 2 và nó rất thật.

Kiểm tra sau 1 ngày chạy:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS --metric-name NumberOfEmptyReceives \
  --dimensions Name=QueueName,Value=taskflow-jobs \
  --start-time 2026-08-01T00:00:00Z --end-time 2026-08-02T00:00:00Z \
  --period 86400 --statistics Sum --profile taskflow
```

Con số nên là vài nghìn, không phải vài triệu.

---

## Definition of Done — Phase 2

- [ ] 4 queue đã tạo, `taskflow-jobs` có DLQ với `maxReceives = 3`
- [ ] Cả 4 queue đều có **Receive message wait = 20s**
- [ ] `TASKFLOW_QUEUE_DRIVER=sqs`, hệ thống chạy **không sửa dòng code nghiệp vụ nào**
- [ ] Thí nghiệm 2: thấy "in flight" trên console
- [ ] Thí nghiệm 3: giết worker → message quay lại sau 180s → worker mới nhận với receive count = 2
- [ ] Thí nghiệm 4: job lỗi tạm thời vào DLQ sau đúng 3 lần
- [ ] Thí nghiệm 5: redrive bằng console thành công
- [ ] Thí nghiệm 6: lỗi vĩnh viễn chỉ 1 execution, không vào DLQ
- [ ] Thí nghiệm 7: 3 worker song song, không xử lý đồng thời cùng job
- [ ] Trang `/dlq` hoạt động
- [ ] `NumberOfEmptyReceives` < 100k/ngày (xác nhận long polling bật)
- [ ] Giải thích được: visibility timeout, receipt handle, receive count, redrive policy
- [ ] Chi phí AWS tháng này < $1

**→ Tiếp theo: [Phase 3 — Terraform, RDS, ECS](phase-3-aws-infra.md)**
