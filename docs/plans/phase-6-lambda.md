# Phase 6 — Lambda, SNS, EventBridge

**Mục tiêu:** xử lý event bằng Lambda, cảnh báo DLQ, dọn dẹp định kỳ.
**Thời gian:** 1 tuần
**Chi phí:** ~$0 (Lambda miễn phí 1M request + 400.000 GB-giây **vĩnh viễn**, không phải free tier 12 tháng)
**Kết quả:** hiểu vai trò event-driven của Lambda **bên cạnh** ECS, không phải thay thế nó.

---

## 6.0. Lambda là gì và khi nào KHÔNG dùng

> 💡 **Lambda** chạy code của bạn để phản ứng với một sự kiện, rồi tắt. Không có server, không có container luôn chạy. Trả tiền theo mili-giây thực thi.
>
> **Vì sao worker của ta không dùng Lambda?** Ba lý do:
> 1. Lambda tối đa **15 phút** mỗi lần chạy. Job dài hơn là không làm được.
> 2. Không kiểm soát được `ChangeMessageVisibility` một cách tự nhiên — Lambda tự quản lý vòng đời message.
> 3. Với workload chạy liên tục, Fargate rẻ hơn.
>
> **Lambda hợp với:** tác vụ ngắn (< 30 giây), không trạng thái, kích hoạt bởi event, chạy không đều. Đúng ba việc dưới đây.

Ba Lambda của dự án:

| Lambda | Trigger | Việc |
|---|---|---|
| `job-event-handler` | SQS `taskflow-notifications` | Gửi email, gọi webhook |
| `dlq-alert` | SNS (từ CloudWatch Alarm) | Cảnh báo khi DLQ có message |
| `maintenance` | EventBridge Scheduler | Dọn job treo, job mồ côi |

---

## 6.1. Chuyển `EventEmitter` sang SQS

Phase 1 đã có interface. Giờ chỉ thêm implementation:

```php
final class SqsEventEmitter implements EventEmitter
{
    public function __construct(private readonly JobQueue $queue) {}

    public function emit(string $event, string $jobId, array $context = []): void
    {
        $this->queue->send(config('taskflow.queues.notifications'), new JobMessage(
            jobId:   $jobId,
            jobType: $event,          // job.completed | job.failed | job.dead_lettered
            payload: $context,
            requestedBy: 0,
        ));
    }
}
```

Đổi env trên ECS task definition:

```hcl
{ name = "TASKFLOW_EVENT_DRIVER", value = "sqs" }   # Phase 3 để "log"
```

Không sửa `JobProcessor`. Đây là lần thứ ba Nguyên tắc 2 trả cổ tức.

---

## 6.2. Lambda `job-event-handler`

> 💡 **Event source mapping là gì:** thay vì bạn viết code poll SQS, Lambda service tự poll hộ và gọi function của bạn với batch message. Nếu function chạy xong không lỗi, Lambda **tự xóa** message. Nếu ném lỗi, Lambda **không xóa** → message quay lại → sau `maxReceiveCount` vào DLQ. Ngữ nghĩa giống hệt worker của bạn, chỉ là AWS lo phần vòng lặp.

`lambdas/job-event-handler/index.mjs` (Node.js 20 — nhẹ và khởi động nhanh hơn PHP):

```js
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({});

export const handler = async (event) => {
  const failures = [];

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);

      if (body.job_type === "job.completed") {
        await ses.send(new SendEmailCommand({
          Source: process.env.FROM_ADDRESS,
          Destination: { ToAddresses: [process.env.ADMIN_EMAIL] },
          Message: {
            Subject: { Data: `Job ${body.job_id} hoàn thành` },
            Body: { Text: { Data: JSON.stringify(body.payload, null, 2) } },
          },
          ConfigurationSetName: process.env.SES_CONFIG_SET,
        }));
      }
    } catch (err) {
      console.error("Xử lý record thất bại", record.messageId, err);
      // Báo cho Lambda biết CHỈ record này lỗi.
      // Không có cơ chế này, cả batch 5 message sẽ bị retry dù chỉ 1 cái hỏng.
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
```

Terraform:

```hcl
resource "aws_lambda_function" "job_event_handler" {
  function_name = "taskflow-job-event-handler"
  role          = aws_iam_role.job_event_handler.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]        # Graviton: rẻ hơn ~20%
  timeout       = 10
  memory_size   = 256

  filename         = data.archive_file.job_event_handler.output_path
  source_code_hash = data.archive_file.job_event_handler.output_base64sha256

  # Chặn Lambda scale ra hàng trăm instance và làm SES throttle.
  # Sandbox chỉ cho 1 msg/giây -> giới hạn concurrency là bắt buộc.
  reserved_concurrent_executions = 5

  environment {
    variables = {
      FROM_ADDRESS   = var.from_address
      ADMIN_EMAIL    = var.admin_email
      SES_CONFIG_SET = "taskflow-default"
    }
  }
}

resource "aws_lambda_event_source_mapping" "notifications" {
  event_source_arn = var.notifications_queue_arn
  function_name    = aws_lambda_function.job_event_handler.arn

  batch_size                         = 5
  maximum_batching_window_in_seconds = 10   # gom message 10s để giảm số lần gọi

  # Cho phép trả về batchItemFailures — nếu không khai báo, một record lỗi
  # sẽ khiến CẢ batch bị retry.
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_cloudwatch_log_group" "job_event_handler" {
  name              = "/aws/lambda/taskflow-job-event-handler"
  retention_in_days = 7
}
```

> ⚠️ Log group của Lambda **phải** tên `/aws/lambda/<function-name>` — Lambda tự tạo nếu chưa có, nhưng khi đó retention là "never expire". Khai báo trước trong Terraform để ép retention 7 ngày.

---

## 6.3. SNS và Lambda `dlq-alert`

> 💡 **Vì sao cần SNS ở giữa:** CloudWatch Alarm **không** gọi Lambda trực tiếp được. Alarm action chỉ hỗ trợ: SNS topic, EC2 action, Auto Scaling action, Systems Manager action. Không có Lambda trong danh sách.
>
> Đây là chi tiết rất hay bị hiểu sai. Kiến trúc đúng là:
> ```
> CloudWatch Alarm -> SNS Topic -> Lambda
>                              \-> Email admin (subscription trực tiếp)
> ```
> Lợi ích phụ: SNS cho phép nhiều subscriber, nên bạn vừa có email vừa có Lambda mà không viết thêm code.
>
> **SNS là gì:** pub/sub message service. Publish một message, mọi subscriber đều nhận được bản sao. Khác SQS (mỗi message chỉ một consumer lấy được).

```hcl
resource "aws_sns_topic" "ops_alerts" {
  name = "taskflow-ops-alerts"
}

# Email admin — subscribe trực tiếp, không cần code
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.ops_alerts.arn
  protocol  = "email"
  endpoint  = var.admin_email
}

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "taskflow-DLQNotEmpty"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 1
  dimensions          = { QueueName = "taskflow-jobs-dlq" }
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.ops_alerts.arn]   # -> SNS, KHÔNG phải -> Lambda
}

resource "aws_sns_topic_subscription" "dlq_lambda" {
  topic_arn = aws_sns_topic.ops_alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.dlq_alert.arn
}

resource "aws_lambda_permission" "sns_invoke" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dlq_alert.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.ops_alerts.arn
}
```

> ⚠️ Sau `terraform apply`, AWS gửi email xác nhận subscription. **Phải bấm confirm** — nếu không, cảnh báo sẽ không bao giờ tới. Đây là lỗi rất hay gặp: cấu hình đúng hết nhưng không nhận được gì.

Lambda `dlq-alert` làm gì:

1. Đọc alarm payload từ SNS message
2. `ReceiveMessage` trên DLQ (**không xóa**) lấy vài mẫu
3. Đối chiếu database lấy `error_message` gần nhất
4. Gửi **một** email tổng hợp (không phải mỗi job một email)
5. Đánh dấu job liên quan thành `dead_lettered`

---

## 6.4. Lambda `maintenance` và EventBridge Scheduler

> 💡 **EventBridge Scheduler** là cron của AWS. Khai báo lịch, nó gọi Lambda đúng giờ. Miễn phí ở quy mô này.

```hcl
resource "aws_scheduler_schedule" "maintenance_frequent" {
  name                = "taskflow-maintenance-5min"
  schedule_expression = "rate(5 minutes)"
  flexible_time_window { mode = "OFF" }

  target {
    arn      = aws_lambda_function.maintenance.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ mode = "frequent" })
  }
}

resource "aws_scheduler_schedule" "maintenance_daily" {
  name                = "taskflow-maintenance-daily"
  schedule_expression = "cron(0 18 * * ? *)"   # 18:00 UTC = 01:00 giờ VN
  flexible_time_window { mode = "OFF" }

  target {
    arn      = aws_lambda_function.maintenance.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ mode = "daily" })
  }
}
```

### Chế độ `frequent` (5 phút) — hai việc quan trọng

**1. Job mồ côi.** Nhớ lại Phase 1: `JobDispatcher` commit DB rồi mới gửi SQS. Nếu `SendMessage` thất bại, job kẹt ở `queued` vĩnh viễn.

```sql
SELECT ulid FROM jobs j
WHERE  j.status = 'queued'
  AND  j.queued_at < NOW() - INTERVAL 10 MINUTE
  AND  NOT EXISTS (SELECT 1 FROM job_executions e WHERE e.job_id = j.id);
```

Tìm được thì **gửi lại message**. Đây chính là lý do Lambda này tồn tại — không phải "dọn dẹp cho có".

**2. Job treo.** Worker chết mà không kịp SIGTERM:

```sql
UPDATE jobs SET status = 'failed', error_code = 'worker_lost', failed_at = NOW()
WHERE status = 'processing' AND heartbeat_at < NOW() - INTERVAL 10 MINUTE;
```

Cột `heartbeat_at` đã có từ migration Phase 1 — đây là lúc nó được dùng.

### Chế độ `daily`

- Xóa `job_executions` cũ hơn 30 ngày
- Tổng hợp thống kê trong ngày

> File S3 **không** cần Lambda dọn — S3 Lifecycle Rule ở Phase 3 đã lo. Luôn ưu tiên tính năng có sẵn hơn code tự viết: miễn phí và không thể hỏng.

---

## 6.5. Lambda truy cập database

Maintenance Lambda cần đọc/ghi MySQL. Hai lựa chọn:

**Cách A — Lambda gọi API nội bộ của Laravel** (đơn giản hơn, khuyến nghị)
Lambda gọi `POST /api/internal/maintenance` với một shared secret. Không cần đặt Lambda trong VPC.

**Cách B — Lambda trong VPC, kết nối trực tiếp RDS**
Đúng bài hơn nhưng: Lambda trong VPC cần ENI, **cold start chậm hơn**, và nếu cần gọi ra Internet thì lại phải có NAT Gateway ($32/tháng).

**Chọn cách A ở Learning Mode.** Ghi chú lại là ở production sẽ chọn B — đó cũng là một bài học về đánh đổi.

---

## 6.6. Kiểm thử

### Test 1 — Event handler
Chạy 1 job → xem log Lambda:
```bash
aws logs tail /aws/lambda/taskflow-job-event-handler --follow --profile taskflow
```

### Test 2 — DLQ alert (kiểm chứng chuỗi Alarm → SNS → Lambda)
Tạo 5 job `failure_probability = 1.0` → chờ vào DLQ → trong 5 phút phải nhận **2 email**: một từ SNS trực tiếp (định dạng thô của CloudWatch), một từ Lambda (định dạng đẹp có chi tiết lỗi).

Nhận được cả hai = toàn bộ chuỗi hoạt động.

### Test 3 — Job mồ côi
Tạo job thủ công trong DB, không gửi SQS:
```sql
INSERT INTO jobs (ulid, user_id, type, status, payload_json, queued_at, created_at)
VALUES ('01ORPHAN...', 1, 'simulate_work', 'queued', '{"duration_seconds":5}',
        NOW() - INTERVAL 15 MINUTE, NOW() - INTERVAL 15 MINUTE);
```
Trong 5 phút, maintenance Lambda phải phát hiện và gửi lại message → job được xử lý.

### Test 4 — Job treo
```sql
UPDATE jobs SET status = 'processing', heartbeat_at = NOW() - INTERVAL 15 MINUTE WHERE id = ?;
```
Trong 5 phút → `status = 'failed'`, `error_code = 'worker_lost'`.

### Test 5 — Batch item failure
Gửi 5 message vào notifications, trong đó 1 cái body hỏng. Kỳ vọng: 4 message được xóa, chỉ 1 message quay lại. Nếu cả 5 quay lại thì `function_response_types` chưa khai báo đúng.

---

## Definition of Done — Phase 6

- [ ] `TASKFLOW_EVENT_DRIVER=sqs`, **không sửa `JobProcessor`**
- [ ] 3 Lambda deploy được bằng Terraform
- [ ] Mỗi Lambda có IAM role **riêng**, log group retention 7 ngày
- [ ] SNS topic có email subscription **đã confirm**
- [ ] Test 2: nhận đủ 2 email khi DLQ có message
- [ ] Test 3: job mồ côi được phát hiện và gửi lại
- [ ] Test 4: job treo bị đánh dấu `worker_lost`
- [ ] Test 5: batch item failure hoạt động
- [ ] `reserved_concurrent_executions = 5` trên job-event-handler
- [ ] Giải thích được: vì sao Alarm không gọi Lambda trực tiếp, vì sao worker không dùng Lambda

**→ Tiếp theo: [Phase 7 — CloudWatch](phase-7-cloudwatch.md)**
