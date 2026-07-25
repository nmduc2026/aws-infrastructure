# Phase 5 — Amazon SES

**Mục tiêu:** gửi email thông báo và theo dõi delivery/bounce/complaint.
**Thời gian:** 4 ngày
**Chi phí:** ~$0 (62.000 email/tháng miễn phí khi gửi từ trong AWS; ta gửi vài chục cái)
**Kết quả:** hiểu vòng đời một email và vì sao bounce rate quan trọng.

---

## 5.0. SES là gì và giới hạn thật của nó

> 💡 **SES (Simple Email Service)** là dịch vụ gửi email khối lượng lớn. Khác Gmail SMTP ở chỗ: có API, có thống kê chi tiết, và **báo lại cho bạn** khi email bị trả về hoặc bị đánh dấu spam.
>
> **Vì sao AWS quan tâm bounce/complaint:** nếu bạn gửi nhiều email tới địa chỉ không tồn tại (**bounce**) hoặc người nhận bấm "báo cáo spam" (**complaint**), các nhà cung cấp email lớn sẽ đưa toàn bộ dải IP của SES vào danh sách đen — ảnh hưởng mọi khách hàng khác. Vì vậy AWS theo dõi rất gắt và **sẽ đình chỉ tài khoản** nếu bounce rate > 5% hoặc complaint rate > 0.1%.

### Sandbox — kỳ vọng cần thực tế ngay từ đầu

Tài khoản SES mới luôn ở **sandbox**:

- Chỉ gửi được tới **địa chỉ đã verify**
- Tối đa **200 email/24 giờ**
- Tối đa **1 message/giây**

Và quan trọng: **yêu cầu production access cho dự án học tập rất hay bị từ chối.** AWS muốn thấy use case thật, danh sách người nhận thật, quy trình xử lý bounce. Đừng xây kế hoạch dựa vào việc chắc chắn được duyệt.

**Kế hoạch cho dự án này: ở nguyên sandbox.** Bạn vẫn học được đầy đủ Configuration Set, event publishing, bounce handling — sandbox không giới hạn những thứ đó.

---

## 5.1. Verify địa chỉ email

**Console → SES → Identities → Create identity → Email address.**

Verify 2–3 địa chỉ:
- 1 địa chỉ làm **người gửi** (`from`)
- 1–2 địa chỉ làm **người nhận** để test

AWS gửi email xác nhận, bấm link trong đó.

> 💡 Nếu có domain riêng thì verify domain sẽ tốt hơn (gửi được từ bất kỳ địa chỉ nào thuộc domain, và cấu hình được DKIM để tăng độ tin cậy). Không có domain thì verify email là đủ cho dự án này.

---

## 5.2. Mailbox Simulator — cách đúng để test bounce

Đây là công cụ quan trọng nhất của phase này và ít người biết.

AWS cung cấp các địa chỉ đặc biệt **luôn tạo ra kết quả xác định**, **không tính vào bounce rate** của bạn, và **không cần verify**:

```
success@simulator.amazonses.com      -> Delivery thành công
bounce@simulator.amazonses.com       -> Hard bounce
complaint@simulator.amazonses.com    -> Complaint (báo cáo spam)
ooto@simulator.amazonses.com         -> Out of office auto-reply
suppressionlist@simulator.amazonses.com -> Bị chặn bởi suppression list
```

> ⚠️ Nếu bạn test bounce bằng cách gửi tới một địa chỉ bịa (`asdasd@gmail.com`), bounce đó **tính vào reputation thật** của bạn. Vài lần là bị AWS cảnh cáo. Luôn dùng simulator.

---

## 5.3. Configuration Set và event publishing

> 💡 **Configuration Set là gì:** một "hồ sơ cấu hình" gắn vào mỗi email gửi đi. Nó cho phép bạn khai báo: khi có sự kiện xảy ra với email này (gửi đi, giao thành công, bị trả về...), hãy đẩy thông tin đó tới đâu.
>
> Không có nó, bạn gửi email xong là mù — không biết có tới nơi không.

```hcl
resource "aws_sesv2_configuration_set" "main" {
  configuration_set_name = "taskflow-default"

  reputation_options { reputation_metrics_enabled = true }
  sending_options    { sending_enabled = true }
}

resource "aws_sesv2_configuration_set_event_destination" "cloudwatch" {
  configuration_set_name = aws_sesv2_configuration_set.main.configuration_set_name
  event_destination_name = "cloudwatch"

  event_destination {
    enabled = true
    matching_event_types = [
      "SEND", "DELIVERY", "BOUNCE", "COMPLAINT",
      "REJECT", "DELIVERY_DELAY", "RENDERING_FAILURE"
    ]

    cloud_watch_destination {
      dimension_configuration {
        dimension_name           = "MessageTag"
        dimension_value_source   = "MESSAGE_TAG"
        default_dimension_value  = "none"
      }
    }
  }
}
```

> 💡 **Bảy loại event:**
> - `SEND` — SES đã nhận yêu cầu
> - `DELIVERY` — máy chủ nhận đã chấp nhận. Đây là "thành công" thật.
> - `BOUNCE` — bị trả về. *Hard* = địa chỉ không tồn tại (đừng gửi lại bao giờ). *Soft* = hộp thư đầy (có thể thử lại sau).
> - `COMPLAINT` — người nhận bấm "spam". Nghiêm trọng nhất.
> - `REJECT` — SES từ chối gửi (thường do phát hiện virus)
> - `DELIVERY_DELAY` — chưa giao được, đang thử lại
> - `RENDERING_FAILURE` — lỗi template

---

## 5.4. Cấu hình Laravel

```dotenv
MAIL_MAILER=ses
MAIL_FROM_ADDRESS=ban@email-da-verify.com
MAIL_FROM_NAME=TaskFlow
SES_CONFIGURATION_SET=taskflow-default
```

```bash
composer require aws/aws-sdk-php
```

`config/services.php`:

```php
'ses' => [
    'key'    => env('AWS_ACCESS_KEY_ID'),
    'secret' => env('AWS_SECRET_ACCESS_KEY'),
    'region' => env('AWS_DEFAULT_REGION'),
    'options' => [
        // Gắn Configuration Set vào MỌI email -> mọi email đều được theo dõi
        'ConfigurationSetName' => env('SES_CONFIGURATION_SET'),
    ],
],
```

Quyền IAM cho worker task role (thêm vào module `iam`):

```json
{
  "Effect": "Allow",
  "Action": ["ses:SendEmail", "ses:SendRawEmail"],
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "ses:FromAddress": "ban@email-da-verify.com"
    }
  }
}
```

Điều kiện `ses:FromAddress` là least privilege thật: kể cả code bị lỗi cũng không gửi được từ địa chỉ khác.

---

## 5.5. Mailable

`app/Mail/JobCompletedMail.php`:

```php
class JobCompletedMail extends Mailable
{
    public function __construct(public readonly Job $job) {}

    public function build()
    {
        $mail = $this->subject("Job {$this->job->type} đã hoàn thành")
                     ->markdown('emails.job-completed');

        // Message tag: cho phép lọc metric theo loại email trong CloudWatch
        $mail->withSymfonyMessage(function ($message) {
            $message->getHeaders()->addTextHeader('X-SES-MESSAGE-TAGS', 'email_type=job_completed');
        });

        return $mail;
    }
}
```

Gọi trong `JobProcessor` sau khi hoàn thành:

```php
// notify = false khi load test -> bảo vệ hạn mức 200 email/ngày
if ($job->notify && $job->user->email) {
    Mail::to($job->user->email)->send(new JobCompletedMail($job));
}
```

> ⚠️ **Bảo vệ hạn mức là bắt buộc.** Load test 500 job mà mỗi job gửi 1 email = vượt hạn mức 200/ngày ngay lập tức, SES throttle, và bạn mất một ngày không test được gì. `LoadTestController` đã set `notify => false` từ Phase 1 — kiểm tra lại nó thật sự hoạt động.

---

## 5.6. Kiểm thử

### Test 1 — Delivery thành công
Tạo user với email `success@simulator.amazonses.com`, chạy 1 job. Sau ~30 giây, xem metric:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/SES --metric-name Delivery \
  --start-time 2026-11-01T00:00:00Z --end-time 2026-11-02T00:00:00Z \
  --period 3600 --statistics Sum --profile taskflow
```

### Test 2 — Bounce
Email `bounce@simulator.amazonses.com` → metric `Bounce` tăng. **Không** ảnh hưởng reputation vì là simulator.

### Test 3 — Complaint
Email `complaint@simulator.amazonses.com` → metric `Complaint` tăng.

### Test 4 — Bảo vệ hạn mức
Chạy load test 300 job. Kiểm tra **không** email nào được gửi:

```bash
aws cloudwatch get-metric-statistics --namespace AWS/SES --metric-name Send \
  --start-time ... --period 3600 --statistics Sum --profile taskflow
# Kỳ vọng: 0
```

Nếu con số khác 0, `notify = false` chưa được truyền đúng — sửa ngay trước khi làm phase sau.

### Test 5 — Rate limit
Gửi 10 email liên tiếp không delay. Sandbox giới hạn 1/giây nên bạn sẽ thấy `Throttling` exception. Đây là lý do Phase 6 phải đặt `reserved_concurrency = 5` cho Lambda.

---

## 5.7. Trang cấu hình thông báo

Route mới `/settings/notifications`:

- Bật/tắt email cho: job completed, job failed, job dead-lettered
- Địa chỉ nhận thông báo
- Bảng lịch sử email gần đây với trạng thái delivery

Lưu vào bảng `users` (thêm cột `notification_prefs` kiểu JSON) — hoặc dùng bảng `webhooks` đã có nếu muốn thống nhất.

---

## Definition of Done — Phase 5

- [ ] 2–3 email đã verify
- [ ] Configuration Set `taskflow-default` với event destination sang CloudWatch
- [ ] Job hoàn thành gửi được email thật, nhận được trong hộp thư
- [ ] Test 2: bounce simulator → metric `Bounce` tăng
- [ ] Test 3: complaint simulator → metric `Complaint` tăng
- [ ] Test 4: load test 300 job → **0 email** được gửi
- [ ] Worker gửi email bằng **Task Role**, không có access key
- [ ] Trang `/settings/notifications` hoạt động
- [ ] Giải thích được: sandbox limit, hard vs soft bounce, vì sao complaint rate 0.1% là nghiêm trọng

**→ Tiếp theo: [Phase 6 — Lambda và SNS](phase-6-lambda.md)**
