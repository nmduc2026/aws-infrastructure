# Phase 7 — CloudWatch đầy đủ

**Mục tiêu:** structured logs, custom metrics, dashboard, alarms — và giữ chi phí trong tầm kiểm soát.
**Thời gian:** 1 tuần
**Chi phí:** +$3–6/tháng — **nếu làm sai có thể thành $70/tháng**, đọc kỹ 7.2
**Kết quả:** nhìn một màn hình là biết hệ thống đang khỏe hay ốm.

---

## 7.0. CloudWatch gồm những gì

> 💡 Ba thứ khác nhau hay bị gộp làm một:
> - **Logs** — dòng text ứng dụng ghi ra. Trả tiền theo GB nhập vào ($0.50/GB) và lưu trữ ($0.03/GB/tháng).
> - **Metrics** — chuỗi số theo thời gian (queue depth, CPU...). Metric của AWS **miễn phí**. Metric bạn tự tạo tốn **$0.30/metric/tháng**.
> - **Alarms** — theo dõi một metric, chuyển trạng thái khi vượt ngưỡng. $0.10/alarm/tháng.

---

## 7.1. Structured logging

Log dạng JSON để query được bằng CloudWatch Logs Insights.

`config/logging.php` — channel mới:

```php
'taskflow' => [
    'driver'    => 'monolog',
    'handler'   => StreamHandler::class,
    'formatter' => JsonFormatter::class,      // mỗi dòng là một JSON object
    'with'      => ['stream' => 'php://stdout'],
    'level'     => 'info',
],
```

> 💡 Ghi ra `stdout` là đúng cho container: ECS log driver `awslogs` bắt stdout và đẩy lên CloudWatch. Không ghi ra file trong container — file sẽ mất khi task dừng.

Thêm context chuẩn cho mọi log:

```php
Log::withContext([
    'service'  => 'ecs-worker',
    'worker_id'=> gethostname(),
]);

Log::info('job.completed', [
    'job_id'       => $job->ulid,
    'job_type'     => $job->type,
    'execution_id' => $execution->id,
    'attempt'      => $execution->attempt,
    'duration_ms'  => $ms,
]);
```

> ⚠️ **Không bao giờ** log access token, password, secret, hay payload nhạy cảm. Log tồn tại 7 ngày và ai có quyền đọc CloudWatch đều xem được.

---

## 7.2. Custom metrics — cảnh báo chi phí

> ⚠️ **Đây là chỗ dễ gây sốc hóa đơn nhất của cả dự án.**
>
> CloudWatch tính $0.30/metric/tháng, và **mỗi tổ hợp dimension là một metric riêng biệt**.
>
> Ví dụ nguy hiểm:
> ```
> 5 metric × 8 job_type × 6 status = 240 metric = $72/tháng
> ```
> Nhiều hơn toàn bộ phần còn lại của hạ tầng cộng lại.

**Ba quy tắc bắt buộc:**

1. **Tối đa 1 dimension**, chỉ dùng `JobType` với ≤ 5 giá trị.
2. **Không bao giờ** đặt `job_id`, `user_id`, `execution_id` làm dimension — cardinality vô hạn.
3. **Dùng EMF thay vì `PutMetricData`.**

### EMF — Embedded Metric Format

> 💡 **EMF là gì:** bạn ghi một dòng log JSON có cấu trúc đặc biệt, CloudWatch tự nhận diện và **trích xuất metric ra khỏi log**. Bạn chỉ trả tiền log ingest ($0.50/GB), không trả tiền cho mỗi API call `PutMetricData`. Code cũng đơn giản hơn — chỉ là ghi log.
>
> Điểm hay nhất: field nào **không** nằm trong `Dimensions` thì vẫn có trong log để tra cứu, nhưng **không** sinh metric. Vậy là bạn giữ được `job_id` để debug mà không tốn tiền.

`app/Support/Metrics/EmfMetrics.php`:

```php
final class EmfMetrics implements Metrics
{
    public function count(string $name, int $value = 1, array $dimensions = []): void
    {
        $this->write($name, $value, 'Count', $dimensions);
    }

    public function timing(string $name, int $ms, array $dimensions = []): void
    {
        $this->write($name, $ms, 'Milliseconds', $dimensions);
    }

    private function write(string $name, int|float $value, string $unit, array $dimensions): void
    {
        // Chỉ giữ dimension nằm trong allowlist -> chặn cardinality bùng nổ
        $allowed = array_intersect_key($dimensions, array_flip(['JobType']));

        $payload = [
            '_aws' => [
                'Timestamp' => (int) (microtime(true) * 1000),
                'CloudWatchMetrics' => [[
                    'Namespace'  => 'TaskFlow',
                    'Dimensions' => $allowed ? [array_keys($allowed)] : [[]],
                    'Metrics'    => [['Name' => $name, 'Unit' => $unit]],
                ]],
            ],
            $name => $value,
        ] + $allowed;

        // fwrite thẳng ra stdout: EMF phải là MỘT dòng JSON độc lập,
        // không được bọc trong format log của Laravel.
        fwrite(STDOUT, json_encode($payload) . PHP_EOL);
    }
}
```

Bật lên:

```hcl
{ name = "TASKFLOW_METRICS_DRIVER", value = "emf" }   # Phase 3 để "null"
```

Lần thứ tư không phải sửa `JobProcessor`.

### Metric của dự án

| Metric | Dimension | Đơn vị |
|---|---|---|
| `JobSuccessCount` | JobType | Count |
| `JobFailureCount` | JobType | Count |
| `JobDuration` | JobType | Milliseconds |
| `JobRetryCount` | JobType | Count |
| `WebhookFailureCount` | (không) | Count |

5 metric × 3 job type ≈ **15 metric = $4.5/tháng**. Trong tầm kiểm soát.

### Logs Insights thay cho metric

Cần số liệu ad-hoc thì query thay vì tạo metric mới:

```
fields @timestamp, job_id, job_type, duration_ms
| filter status = "completed"
| stats avg(duration_ms), pct(duration_ms, 95), count() by job_type
```

Trả tiền theo lượng dữ liệu quét ($0.005/GB), rẻ hơn nhiều so với giữ metric thường trực. Lưu các query hay dùng lại.

---

## 7.3. Dashboard

Một dashboard tên `taskflow` (3 dashboard đầu miễn phí).

```hcl
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "taskflow"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", width = 12, height = 6, x = 0, y = 0
        properties = {
          title  = "Queue depth vs Running tasks"
          region = var.region
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", "taskflow-jobs"],
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", "taskflow", "ServiceName", "taskflow-worker", { yAxis = "right" }]
          ]
          period = 60, stat = "Average"
        }
      },
      # ... các widget khác
    ]
  })
}
```

**Widget số 1 là widget giá trị nhất của cả dashboard.** Đặt queue depth và running task chồng lên nhau (một trục trái, một trục phải) cho bạn thấy trực quan auto scaling phản ứng thế nào và độ trễ bao lâu.

Các widget còn lại:

2. `ApproximateAgeOfOldestMessage` — chỉ báo sức khỏe tốt nhất. Tăng liên tục = worker không theo kịp.
3. CPU và memory worker
4. `JobSuccessCount` vs `JobFailureCount`
5. `JobDuration` (average và p95)
6. DLQ depth
7. SES delivery/bounce/complaint
8. Lambda invocations và errors

---

## 7.4. Alarms

| Alarm | Điều kiện | Ý nghĩa |
|---|---|---|
| `QueueBacklogHigh` | visible > 200 trong 5 phút | Tải cao bất thường |
| `OldMessageDetected` | age > 300 giây | Worker không theo kịp |
| `DLQNotEmpty` | DLQ >= 1 | Có job hỏng (đã làm ở Phase 6) |
| `WorkerMemoryHigh` | memory > 85% trong 5 phút | Rò rỉ bộ nhớ |
| `JobFailureRateHigh` | tỷ lệ lỗi > 10% | Bug mới deploy |
| `NoWorkerRunning` | tasks = 0 **và** queue > 0 trong 5 phút | Scaling hỏng |
| `BillingAlert` | EstimatedCharges > $25 | **Quan trọng nhất** |

### `JobFailureRateHigh` — dùng metric math

```hcl
resource "aws_cloudwatch_metric_alarm" "failure_rate" {
  alarm_name          = "taskflow-JobFailureRateHigh"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 10
  alarm_actions       = [var.sns_topic_arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "rate"
    expression  = "IF(success + failure > 0, 100 * failure / (success + failure), 0)"
    label       = "Failure rate %"
    return_data = true
  }
  metric_query {
    id = "success"
    metric { namespace = "TaskFlow", metric_name = "JobSuccessCount", period = 300, stat = "Sum" }
  }
  metric_query {
    id = "failure"
    metric { namespace = "TaskFlow", metric_name = "JobFailureCount", period = 300, stat = "Sum" }
  }
}
```

Lại là `IF(... > 0, ...)` — chia cho 0 xuất hiện lần thứ hai trong dự án.

### `BillingAlert` — chỉ tạo được ở us-east-1

```hcl
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

resource "aws_cloudwatch_metric_alarm" "billing" {
  provider            = aws.us_east_1     # BẮT BUỘC
  alarm_name          = "taskflow-BillingAlert"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = 21600             # 6 giờ — metric này cập nhật chậm
  statistic           = "Maximum"
  threshold           = 25
  dimensions          = { Currency = "USD" }
  alarm_actions       = [aws_sns_topic.ops_alerts_us.arn]
}
```

> 💡 Metric `AWS/Billing` **chỉ tồn tại ở us-east-1**, bất kể bạn triển khai ở đâu. Cần cả một SNS topic ở us-east-1 vì alarm chỉ gọi được SNS cùng region. Dự án triển khai luôn ở us-east-1 nên không phải xử lý cross-region ở đây.

### `treat_missing_data` — chi tiết quan trọng

Khi worker ở 0 task, nhiều metric **không có dữ liệu**. Đặt sai thì alarm bắn nhầm liên tục và bạn sẽ tắt thông báo.

| Alarm | Nên đặt | Vì sao |
|---|---|---|
| `QueueBacklogHigh` | `notBreaching` | Không có message = tốt |
| `NoWorkerRunning` | `notBreaching` | Không có metric = không có queue = ổn |
| `WorkerMemoryHigh` | `notBreaching` | Không có task = không có memory |
| `DLQNotEmpty` | `notBreaching` | Không có message = tốt |

---

## 7.5. Diễn tập sự cố

Cấu hình alarm không đủ — phải kiểm chứng nó thật sự bắn.

| Kịch bản | Cách tạo | Alarm phải bắn | Trong bao lâu |
|---|---|---|---|
| Queue dồn | 500 job, giữ `max_capacity = 1` | `QueueBacklogHigh` | ~7 phút |
| Message cũ | như trên | `OldMessageDetected` | ~10 phút |
| DLQ | 5 job lỗi vĩnh viễn retryable | `DLQNotEmpty` | ~6 phút |
| Tỷ lệ lỗi | 50 job `failure_probability = 0.5` | `JobFailureRateHigh` | ~12 phút |
| Không worker | `desired_count = 0` + 100 job | `NoWorkerRunning` | ~6 phút |

Ghi lại **thời gian thực tế** từ lúc gây lỗi tới lúc nhận email. Con số đó chính là MTTD (mean time to detect) của hệ thống bạn — và nó là thứ đáng ghi vào learning journal nhất.

---

## 7.6. Trang `/monitoring` trên React

- Nhúng CloudWatch metric qua API (`GetMetricData`) — không nhúng iframe console
- Bảng trạng thái alarm hiện tại
- Ước tính chi phí tháng này (`ce:GetCostAndUsage`)

Widget chi phí là widget bạn sẽ nhìn nhiều nhất trong 2 tháng còn lại.

---

## 7.7. Kiểm tra chi phí metric

```bash
aws cloudwatch list-metrics --namespace TaskFlow \
  --query 'length(Metrics)' --profile taskflow
```

Con số phải **< 30**. Nếu > 50, có dimension nào đó đang bùng nổ — tìm và sửa ngay, vì mỗi metric là $0.30/tháng và nó tích lũy.

---

## Definition of Done — Phase 7

- [ ] Toàn bộ log là JSON, có `service`, `job_id`, `job_type`
- [ ] `TASKFLOW_METRICS_DRIVER=emf`, **không sửa `JobProcessor`**
- [ ] `list-metrics` trả về **< 30 metric**
- [ ] Mọi log group có retention 7 ngày
- [ ] Dashboard `taskflow` có widget queue depth + running tasks chồng nhau
- [ ] 7 alarm đã tạo, `treat_missing_data` đặt đúng
- [ ] `BillingAlert` tạo ở **us-east-1**
- [ ] Đã diễn tập **ít nhất 3** kịch bản và nhận được email thật
- [ ] Ghi lại MTTD cho từng kịch bản
- [ ] Lưu 3–5 query Logs Insights
- [ ] Trang `/monitoring` hoạt động
- [ ] Chi phí CloudWatch tháng < $8

**→ Tiếp theo: [Phase 8 — Production-like](phase-8-prod-like.md)**
