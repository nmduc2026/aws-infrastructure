# Phase 4 — Auto Scaling

**Mục tiêu:** số worker tự tăng khi queue dài, tự về 0 khi hết việc — không mất job khi scale in.
**Thời gian:** 1 tuần
**Chi phí:** +$3–8 (Fargate lúc scale out; Container Insights ~$2/tháng)
**Kết quả:** đây là phase "wow" của cả dự án — nhìn biểu đồ queue depth và running task phản ứng với nhau.

---

## 4.0. Vì sao không scale theo CPU

Cách mặc định ai cũng nghĩ tới là scale theo CPU. Với worker thì **sai**.

Worker của ta dành phần lớn thời gian **chờ I/O** — chờ SQS trả message, chờ database, chờ S3. CPU có thể chỉ 15% trong khi queue dồn 500 message. Scale theo CPU sẽ không phản ứng gì cả.

Metric đúng là **backlog per task**:

```
backlog per task = số message đang chờ / số task đang chạy
```

Nó trả lời đúng câu hỏi cần hỏi: *"mỗi worker đang phải gánh bao nhiêu việc?"*

**Chọn giá trị target:**

```
Thời gian xử lý 1 job trung bình : 15 giây
Độ trễ chấp nhận được            : 5 phút = 300 giây
Target backlog per task          = 300 / 15 = 20 message/task
```

---

## 4.1. Bật Container Insights

Auto Scaling cần metric `RunningTaskCount`, chỉ có khi bật Container Insights.

```hcl
resource "aws_ecs_cluster" "main" {
  name = var.project
  setting {
    name  = "containerInsights"
    value = "enabled"        # Phase 3 để "disabled", giờ đổi
  }
}
```

> 💡 Container Insights thu thập metric chi tiết về cluster/service/task. Tính phí như custom metric, khoảng **$2–3/tháng** với 1 cluster và 1 service. Chấp nhận được, nhưng nhớ tắt lại nếu nghỉ dài.

---

## 4.2. Scalable target

> 💡 **Application Auto Scaling là gì:** một dịch vụ riêng biệt (không phải EC2 Auto Scaling) chuyên điều chỉnh "sức chứa" của nhiều loại tài nguyên AWS — trong đó có `desired_count` của ECS service. Bạn khai báo giới hạn min/max, rồi gắn các **policy** quyết định khi nào tăng/giảm.

`modules/autoscaling/main.tf`:

```hcl
resource "aws_appautoscaling_target" "worker" {
  service_namespace  = "ecs"
  resource_id        = "service/${var.cluster_name}/${var.service_name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = 0     # scale-to-zero: không có việc thì không tốn tiền
  max_capacity       = 10    # trần cứng bảo vệ ngân sách
}
```

`max_capacity = 10` là hàng rào chi phí: dù bug gì xảy ra, tối đa 10 task × $0.0123/giờ = $0.12/giờ.

---

## 4.3. Bẫy scale-to-zero — đọc trước khi làm

Đây là chỗ khiến rất nhiều người bỏ cuộc ở phase này.

Khi `min_capacity = 0` và service đang ở 0 task:

```
backlog = số message / số task = 100 / 0 = KHÔNG XÁC ĐỊNH
```

Target tracking không có số liệu hợp lệ để hành động → **service kẹt ở 0 task vĩnh viễn dù queue đầy**. Bạn sẽ ngồi nhìn 500 message không ai xử lý và không hiểu vì sao.

Cần **hai cơ chế phối hợp**:

| Cơ chế | Lo phần nào |
|---|---|
| Alarm `WakeUpWorker` + step scaling | 0 → 1 |
| Target tracking backlog-per-task | 1 → N và N → 1 |
| Alarm `QueueEmpty` + step scaling | 1 → 0 |

### Cơ chế 1 — Đánh thức từ 0

```hcl
resource "aws_cloudwatch_metric_alarm" "wake_up" {
  alarm_name          = "taskflow-WakeUpWorker"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 1
  dimensions          = { QueueName = var.jobs_queue_name }
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_appautoscaling_policy.wake_up.arn]
}

resource "aws_appautoscaling_policy" "wake_up" {
  name               = "taskflow-wake-up"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = "ecs"

  step_scaling_policy_configuration {
    adjustment_type         = "ExactCapacity"   # ĐẶT về đúng 1, không phải cộng thêm
    cooldown                = 60
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_lower_bound = 0
      scaling_adjustment          = 1
    }
  }
}
```

### Cơ chế 2 — Target tracking

```hcl
resource "aws_appautoscaling_policy" "backlog" {
  name               = "taskflow-backlog-per-task"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = "ecs"

  target_tracking_scaling_policy_configuration {
    target_value       = 20      # 20 message mỗi task
    scale_out_cooldown = 60      # nhanh: queue dồn thì phải phản ứng gấp
    scale_in_cooldown  = 300     # chậm: tránh liên tục tạo/hủy task

    customized_metric_specification {
      metrics {
        id    = "visible"
        label = "Messages visible"
        metric_stat {
          metric {
            namespace   = "AWS/SQS"
            metric_name = "ApproximateNumberOfMessagesVisible"
            dimensions { name = "QueueName", value = var.jobs_queue_name }
          }
          stat = "Average"
        }
        return_data = false
      }

      metrics {
        id    = "tasks"
        label = "Running tasks"
        metric_stat {
          metric {
            namespace   = "ECS/ContainerInsights"
            metric_name = "RunningTaskCount"
            dimensions {
              name  = "ClusterName"
              value = var.cluster_name
            }
            dimensions {
              name  = "ServiceName"
              value = var.service_name
            }
          }
          stat = "Average"
        }
        return_data = false
      }

      metrics {
        id = "backlog"
        # IF(tasks > 0, ...) chính là lá chắn chống chia-cho-0.
        # Khi tasks = 0, trả về chính số message -> vượt target -> kích scale out.
        expression  = "IF(tasks > 0, visible / tasks, visible)"
        label       = "Backlog per task"
        return_data = true
      }
    }
  }
}
```

### Cơ chế 3 — Về 0 khi hết việc

```hcl
resource "aws_cloudwatch_metric_alarm" "queue_empty" {
  alarm_name          = "taskflow-QueueEmpty"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 5          # 5 phút liên tục rỗng mới hạ
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 1
  dimensions          = { QueueName = var.jobs_queue_name }
  treat_missing_data  = "breaching"    # không có dữ liệu = rỗng = hạ về 0

  alarm_actions = [aws_appautoscaling_policy.scale_to_zero.arn]
}

resource "aws_appautoscaling_policy" "scale_to_zero" {
  name               = "taskflow-scale-to-zero"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = "ecs"

  step_scaling_policy_configuration {
    adjustment_type = "ExactCapacity"
    cooldown        = 300
    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = 0
    }
  }
}
```

> ⚠️ Cẩn thận: `ApproximateNumberOfMessagesVisible` **không đếm** message đang "in flight". Queue có thể hiển thị 0 trong khi vẫn còn task đang xử lý. Điều đó không sao — ECS chỉ dừng task khi nó thoát sạch, và SIGTERM handling ở 4.4 đảm bảo job đang chạy được hoàn thành hoặc trả lại queue.

---

## 4.4. SIGTERM — không có phần này thì scale-in làm hỏng job

> 💡 **Điều gì xảy ra khi ECS dừng một task:**
> 1. ECS gửi `SIGTERM` cho process chính trong container.
> 2. Chờ `stopTimeout` giây (ta đặt 120 ở Phase 3).
> 3. Nếu process chưa thoát → `SIGKILL`, giết ngay lập tức.
>
> Không xử lý `SIGTERM` thì mỗi lần scale in, job đang chạy bị giết ngang. Message sẽ quay lại queue sau visibility timeout nên **không mất**, nhưng bạn tốn thêm một lần xử lý và `job_executions` đầy attempt thất bại vô nghĩa.

Code đã viết ở Phase 1 (`ConsumeQueue::handle`). Giờ kiểm chứng nó thật sự chạy trên Fargate.

Bổ sung phần trả message về queue khi không kịp xử lý xong:

```php
// Trong vòng lặp chính, sau khi nhận message
if ($this->shouldStop) {
    // Đã nhận SIGTERM mà chưa kịp xử lý -> trả message về NGAY
    // (visibility = 0) thay vì để worker khác chờ hết 180 giây.
    $queue->changeVisibility($queueName, $message, 0);
    break;
}
```

Và trong handler dài, kiểm tra định kỳ:

```php
// JobContext::checkCancelled() cũng nên kiểm tra shutdown
public function checkShutdown(): void
{
    if (WorkerState::isShuttingDown()) {
        throw new WorkerShuttingDownException();  // -> Outcome::retry(), message quay lại
    }
}
```

**Kiểm chứng bằng thật:**

```bash
# Tạo job 60 giây, để worker bắt đầu xử lý, rồi ép dừng task
TASK_ARN=$(aws ecs list-tasks --cluster taskflow --service-name taskflow-worker \
  --query 'taskArns[0]' --output text --profile taskflow)

aws ecs stop-task --cluster taskflow --task $TASK_ARN --profile taskflow

# Xem log — phải thấy dòng SIGTERM
aws logs tail /taskflow/ecs-worker --follow --profile taskflow
```

Kỳ vọng trong log:
```
SIGTERM nhận được — ngừng nhận message mới, xử lý nốt việc đang làm
Worker đã dừng sạch sẽ
```

Nếu không thấy dòng nào, extension `pcntl` chưa được cài trong image. Kiểm tra:
```bash
docker run --rm taskflow-worker php -m | grep pcntl
```

---

## 4.5. Độ trễ thực tế — biết trước để không kết luận sai

Đây là phần nhiều người hiểu nhầm và tưởng auto scaling hỏng.

| Bước | Thời gian |
|---|---|
| SQS phát metric `ApproximateNumberOfMessagesVisible` | mỗi **60 giây** |
| Alarm cần 1–2 datapoint để chuyển trạng thái | 1–2 phút |
| Application Auto Scaling gọi ECS đổi desired count | vài giây |
| Fargate cấp phát, kéo image, khởi động PHP | 30–90 giây |
| **Tổng: từ khi queue tăng tới khi worker mới xử lý** | **2–4 phút** |

**Hệ quả trực tiếp: load test phải kéo dài ít nhất 10–15 phút.**

Test 100 job × 5 giây xong trong 40 giây → queue cạn trước khi task thứ hai kịp khởi động → bạn kết luận nhầm "auto scaling không chạy". Đây là sai lầm phổ biến nhất ở phase này.

---

## 4.6. Năm bài load test

### Test A — Scale out
```
500 job × 20 giây, failure = 0%, notify = false
≈ 2.8 giờ công việc cho 1 worker
```
Quan sát 20 phút. Kỳ vọng: 0 → 1 (alarm WakeUp, ~2 phút) → 3 → 6 → 10 (target tracking, ~8 phút) → queue giảm nhanh dần.

### Test B — Scale in
Sau Test A, ngồi yên 20 phút. Kỳ vọng: giảm dần từng bước với cooldown 300s, cuối cùng về 0. **Kiểm tra không job nào bị lỗi trong lúc scale in** — đó là bằng chứng SIGTERM handling đúng.

```sql
SELECT status, COUNT(*) FROM jobs WHERE created_at > NOW() - INTERVAL 1 HOUR GROUP BY status;
-- Kỳ vọng: chỉ có completed. Không có failed do bị giết ngang.
```

### Test C — DLQ dưới tải
20 job với `failure_probability = 1.0`, `failure_type = retryable`. Kỳ vọng: mỗi job đúng 3 execution, sau ~10 phút cả 20 vào DLQ.

### Test D — Idempotency dưới tải (bài quan trọng nhất)
Đang chạy Test A với 8 task, `stop-task` **3 task cùng lúc**.

```sql
-- Không job nào có 2 execution 'completed'
SELECT job_id, COUNT(*) FROM job_executions
WHERE status = 'completed' GROUP BY job_id HAVING COUNT(*) > 1;
```

Kết quả phải rỗng. Đây là kiểm chứng compare-and-set trong điều kiện khắc nghiệt nhất.

### Test E — Trần scaling
1.000 job. Kỳ vọng: dừng đúng ở 10 task, không vượt. `max_capacity` là hàng rào chi phí và nó phải hoạt động.

---

## 4.7. Trang `/workers` trên React

Thêm route mới (Nguyên tắc 7):

- Số task đang chạy (`GET /api/workers/status` — Laravel gọi `ecs:DescribeServices`)
- Queue depth và số in-flight
- Backlog per task tính realtime
- Biểu đồ 30 phút gần nhất: queue depth và running tasks **chồng lên nhau**

Biểu đồ chồng đó là thứ đáng xem nhất — bạn thấy trực quan độ trễ 2–4 phút giữa "queue tăng" và "task tăng".

Cần thêm quyền cho IAM user local:
```json
{ "Effect": "Allow", "Action": ["ecs:DescribeServices", "ecs:ListTasks"], "Resource": "*" }
```

---

## 4.8. Chi phí phase này

| Hạng mục | Chi phí |
|---|---:|
| Container Insights | ~$2–3/tháng |
| Fargate lúc load test (10 task × 20 phút) | ~$0.04/lần |
| CloudWatch alarms (3 cái) | $0.30/tháng |
| **Tổng thêm** | **~$3/tháng** |

Load test **rẻ đến bất ngờ** — $0.04 một lần. Thứ đắt là hạ tầng nằm chờ, không phải hạ tầng làm việc. Cứ test thoải mái.

---

## Definition of Done — Phase 4

- [ ] Scalable target min=0, max=10
- [ ] Alarm `WakeUpWorker` đưa service từ 0 lên 1
- [ ] Target tracking có `IF(tasks > 0, ...)` trong metric math
- [ ] Alarm `QueueEmpty` đưa về 0 sau 5 phút rỗng
- [ ] Test A: thấy 0 → 10 task trong ~10 phút
- [ ] Test B: về 0, **không job nào failed do scale in**
- [ ] Log ECS có dòng "SIGTERM nhận được" khi stop-task
- [ ] Test D: 3 task bị giết, không job nào completed 2 lần
- [ ] Test E: dừng đúng ở 10 task
- [ ] Trang `/workers` hiển thị biểu đồ queue depth + running tasks
- [ ] Giải thích được: vì sao không scale theo CPU, bẫy chia-cho-0, độ trễ 2–4 phút
- [ ] Đã chạy `sleep.sh` sau khi test xong

**→ Tiếp theo: [Phase 5 — SES](phase-5-ses.md)** (hoặc nhảy sang Phase 6, hai phase này độc lập)
