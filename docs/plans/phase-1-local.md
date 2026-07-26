# Phase 1 — Toàn bộ hệ thống chạy local

**Mục tiêu:** dựng đầy đủ luồng nghiệp vụ (DB → API → Worker → FE) mà **chưa dùng AWS**.
**Thời gian:** 2–3 tuần — phase dài nhất
**Chi phí:** $0
**Kết quả:** tạo job từ React, worker xử lý, thấy tiến độ realtime, job lỗi tự retry rồi vào DLQ — tất cả trên máy bạn.

---

## 1.0. Vì sao phase này quan trọng nhất

Phase 1 chiếm khoảng **60% tổng lượng code** của cả dự án và tốn **$0**. Mọi lỗi logic phát hiện ở đây đều miễn phí và sửa trong vài phút. Cũng lỗi đó phát hiện ở Phase 4 thì bạn phải build image, push ECR, update ECS service, chờ 5 phút, đọc CloudWatch Logs — mỗi vòng lặp 15 phút thay vì 15 giây.

Điểm mấu chốt: **`DatabaseJobQueue` ở phase này mô phỏng đúng ngữ nghĩa SQS** — visibility timeout, receipt handle, receive count, redrive sang DLQ. Nhờ vậy code worker viết ở đây chạy y nguyên trên SQS thật ở Phase 2, và bạn học được vòng đời message mà không tốn xu nào.

---

## 1.1. Thứ tự thực hiện

```
1.2   Docker Compose (MySQL)
1.3   Database schema — MỘT migration duy nhất cho cả 8 phase
1.4   Eloquent model
1.5   Lớp trừu tượng: exception, DTO, interface, implementation
1.6   DatabaseJobQueue — mô phỏng SQS
1.7   Service provider — nối driver vào container
1.8   Handler cho từng job_type
1.9   Outcome, JobDispatcher (phía API), JobProcessor (phía worker)
1.10  Consumer command
1.11  REST API + Sanctum
1.12  React: API client, auth, các trang
1.13  Kiểm thử
```

Thứ tự này là thứ tự phụ thuộc: **mỗi bước chỉ dùng những gì các bước trước đã tạo ra.** Làm đúng theo nó thì không bước nào phải quay lại sửa bước trước. Hai chỗ dễ bị cám dỗ làm sớm:

- **Service provider (1.7) không nằm chung với interface (1.5).** Provider `new` ra cả 4 implementation, mà `DatabaseJobQueue` mãi 1.6 mới có. Viết provider ở 1.5 thì `php artisan` sẽ đứng ngay vì container không resolve được class chưa tồn tại.
- **Exception nằm ở 1.5, trước DTO.** `JobMessage::fromArray()` ném `NonRetryableException`, nên exception phải có trước.

---

## 1.2. Docker Compose

Tạo `docker-compose.yml` ở thư mục gốc:

```yaml
services:
  mysql:
    image: mysql:8.0
    container_name: mysql
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: taskflow
      MYSQL_USER: taskflow
      MYSQL_PASSWORD: 123123
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-proot"]
      interval: 5s
      retries: 10

volumes:
  mysql_data:
```

```bash
docker compose up -d
```

`backend/.env`:

```dotenv
APP_NAME=TaskFlow
APP_ENV=local
APP_DEBUG=true
APP_URL=http://localhost:8000

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=taskflow
DB_USERNAME=taskflow
DB_PASSWORD=123123

# Driver của TaskFlow — Nguyên tắc 4: đổi phase = đổi env, không sửa code
TASKFLOW_QUEUE_DRIVER=database
TASKFLOW_EVENT_DRIVER=log
TASKFLOW_STORAGE_DRIVER=local
TASKFLOW_METRICS_DRIVER=null

TASKFLOW_VISIBILITY_TIMEOUT=180
TASKFLOW_MAX_RECEIVE_COUNT=3
TASKFLOW_WORKER_TIMEOUT=150

MAIL_MAILER=log
FRONTEND_URL=http://localhost:5173
```

---

## 1.3. Database schema

> ⚠️ **Bẫy tên bảng:** Laravel dùng tên `jobs` cho database queue driver của nó. Ta **không** dùng driver đó (ta tự viết queue), nên tên `jobs` còn trống. Nhưng **tuyệt đối không chạy `php artisan queue:table`** — lệnh đó sẽ tạo migration đè lên bảng `jobs` của bạn.

### Migration 1 — bảng `jobs`

`backend/database/migrations/2026_07_25_000001_create_jobs_table.php`

```php
Schema::create('jobs', function (Blueprint $table) {
    $table->id();
    $table->ulid('ulid')->unique(); // Public ID dùng trong message, log, URL

    // Relationships
    $table->foreignId('user_id')
        ->constrained()
        ->cascadeOnDelete();

    // Job information
    $table->string('type', 50); // simulate_work | generate_report | send_email
    $table->string('status', 20)->default('queued');
    $table->string('priority', 10)->default('normal');

    // Payload & result
    $table->json('payload_json');
    $table->unsignedTinyInteger('progress')->default(0); // 0..100
    $table->json('result_json')->nullable();
    $table->string('result_s3_key', 512)->nullable(); // Phase 3

    // Future phases (khai báo trước để tránh ALTER TABLE)
    $table->boolean('cancel_requested')->default(false); // Phase 1
    $table->timestamp('heartbeat_at')->nullable(); // Phase 4
    $table->boolean('notify')->default(true); // Phase 5

    // Error handling
    $table->string('error_code', 50)->nullable();
    $table->text('error_message')->nullable();
    $table->unsignedTinyInteger('attempts')->default(0);

    // Timestamps
    $table->timestamp('created_at')->useCurrent();
    $table->timestamp('queued_at')->nullable();
    $table->timestamp('started_at')->nullable();
    $table->timestamp('completed_at')->nullable();
    $table->timestamp('failed_at')->nullable();

    // Indexes
    $table->index(['status', 'created_at']); // Maintenance quét job treo
    $table->index(['user_id', 'created_at']); // Danh sách job của user
    $table->index('type');
});
```

Trạng thái hợp lệ: `queued`, `processing`, `completed`, `failed`, `cancelling`, `cancelled`, `dead_lettered`.

> Không có trạng thái `pending`. Job được insert thẳng với `queued` bên trong transaction, message gửi **sau khi commit** — xem 1.9.

### Migration 2 — bảng `job_executions`

```php
Schema::create('job_executions', function (Blueprint $table) {
    $table->id();

    // Relationships
    $table->foreignId('job_id')
        ->constrained()
        ->cascadeOnDelete();

    // Execution information
    $table->unsignedTinyInteger('attempt'); // = SQS receive_count
    $table->string('worker_id', 100); // ECS container hostname
    $table->string('status', 20); // running | completed | failed

    // AWS metadata
    $table->string('ecs_task_arn')->nullable(); // Phase 3
    $table->string('sqs_receipt_handle', 1024)->nullable();

    // Execution time
    $table->timestamp('started_at');
    $table->timestamp('finished_at')->nullable();
    $table->unsignedInteger('duration_ms')->nullable();

    // Error handling
    $table->string('error_code', 50)->nullable();
    $table->text('error_message')->nullable();

    // Additional metadata
    $table->json('metadata_json')->nullable();

    $table->timestamps();

    // Idempotency: cùng job + cùng lần nhận chỉ ghi một execution
    $table->unique(['job_id', 'attempt']);
});
```

### Migration 3 — bảng `job_queue_messages` (chỉ dùng ở Phase 1)

Đây là bảng mô phỏng SQS. Từ Phase 2 nó không còn được dùng nhưng **vẫn giữ lại** để có thể quay về chế độ offline bất cứ lúc nào.

```php
Schema::create('job_queue_messages', function (Blueprint $table) {
    $table->id();

    // Queue information
    $table->string('queue_name', 80)->index(); // taskflow-jobs | taskflow-jobs-dlq
    $table->json('body');

    // Message state
    $table->string('receipt_handle', 64)->nullable();
    $table->unsignedTinyInteger('receive_count')->default(0);
    $table->timestamp('visible_at')->useCurrent(); // Message sẽ "ẩn" đến thời điểm này

    // Timestamps
    $table->timestamp('created_at')->useCurrent();

    // Indexes
    $table->index(['queue_name', 'visible_at']);
});
```

> 💡 **Ba cột này chính là SQS:**
> - `visible_at` — **visibility timeout**. Khi worker nhận message, SQS không xóa nó mà chỉ giấu đi trong N giây. Nếu worker xử lý xong và gọi delete thì message biến mất; nếu worker chết, hết N giây message hiện lại và worker khác nhận được. Đây là cơ chế đảm bảo không mất job.
> - `receive_count` — đếm số lần message đã được giao. Khi vượt `maxReceiveCount`, SQS tự chuyển nó sang DLQ.
> - `receipt_handle` — mã định danh của **một lần nhận cụ thể**, không phải của message. Muốn xóa hay gia hạn message, bạn phải đưa đúng receipt handle của lần nhận đó.

### Migration 4 và 5 — webhooks

```php
Schema::create('webhooks', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('name');
    $table->string('url', 1024);
    $table->string('secret', 64);
    $table->boolean('is_active')->default(true);
    $table->json('events_json');    // ["job.completed","job.failed"]
    $table->timestamps();
});

Schema::create('webhook_deliveries', function (Blueprint $table) {
    $table->id();
    $table->foreignId('webhook_id')->constrained()->cascadeOnDelete();
    $table->foreignId('job_id')->constrained()->cascadeOnDelete();
    $table->string('event', 50);
    $table->string('idempotency_key')->unique();   // chống gửi trùng — xem 1.9
    $table->string('status', 20);                   // pending | sent | failed
    $table->unsignedSmallInteger('http_status')->nullable();
    $table->unsignedTinyInteger('attempt')->default(0);
    $table->text('request_body');
    $table->text('response_body')->nullable();
    $table->timestamp('sent_at')->nullable();
    $table->timestamps();
});
```

```bash
cd backend && php artisan migrate
```

---

## 1.4. Eloquent model

Migration mới chỉ tạo bảng. Toàn bộ code từ 1.8 trở đi làm việc qua model, nên dựng model ngay bây giờ.

Cài Sanctum ở bước này luôn, vì `User` cần trait `HasApiTokens`. Phần route và controller để tới 1.11.

```bash
cd backend
composer require laravel/sanctum
php artisan vendor:publish --provider="Laravel\Sanctum\SanctumServiceProvider"
php artisan migrate
```

`app/Models/User.php` — thêm trait và quan hệ:

```php
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    public function jobs(): HasMany
    {
        return $this->hasMany(Job::class);
    }
}
```

`app/Models/Job.php`:

```php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\{BelongsTo, HasMany};

class Job extends Model
{
    // Bảng `jobs` có created_at do migration tự đặt useCurrent, không có updated_at
    public $timestamps = false;

    protected $guarded = [];

    // payload_json / result_json là cột JSON — cast để đọc ghi bằng array PHP.
    // Thiếu cast thì $job->payload_json trả về chuỗi và handler sẽ vỡ.
    protected $casts = [
        'payload_json'     => 'array',
        'result_json'      => 'array',
        'cancel_requested' => 'boolean',
        'notify'           => 'boolean',
        'created_at'       => 'datetime',
        'queued_at'        => 'datetime',
        'started_at'       => 'datetime',
        'completed_at'     => 'datetime',
        'failed_at'        => 'datetime',
        'heartbeat_at'     => 'datetime',
    ];

    // ULID là ID công khai — mọi route dùng nó thay cho id tự tăng
    public function getRouteKeyName(): string
    {
        return 'ulid';
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function executions(): HasMany
    {
        return $this->hasMany(JobExecution::class)->orderBy('attempt');
    }
}
```

`app/Models/JobExecution.php`:

```php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class JobExecution extends Model
{
    protected $guarded = [];

    protected $casts = [
        'metadata_json' => 'array',
        'started_at'    => 'datetime',
        'finished_at'   => 'datetime',
    ];

    public function job(): BelongsTo
    {
        return $this->belongsTo(Job::class);
    }
}
```

`app/Models/Webhook.php` và `app/Models/WebhookDelivery.php` — Phase 5 mới dùng đến, dựng sẵn cho đủ bộ:

```php
class Webhook extends Model
{
    protected $guarded = [];
    protected $hidden  = ['secret'];
    protected $casts   = ['events_json' => 'array', 'is_active' => 'boolean'];

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}

class WebhookDelivery extends Model
{
    protected $guarded = [];
    protected $casts   = ['sent_at' => 'datetime'];

    public function webhook(): BelongsTo { return $this->belongsTo(Webhook::class); }
    public function job(): BelongsTo     { return $this->belongsTo(Job::class); }
}
```

> 💡 **Vì sao `$guarded = []` chứ không phải `$fillable`:** mọi lệnh ghi vào các bảng này đều xuất phát từ code của ta (dispatcher, processor), không bao giờ từ `$request->all()`. Dữ liệu người dùng luôn đi qua Form Request ở 1.11 rồi mới tới model. Liệt kê `$fillable` ở đây chỉ tạo thêm một chỗ phải nhớ cập nhật mỗi lần thêm cột.

---

## 1.5. Lớp trừu tượng (Nguyên tắc 2)

Đây là phần quyết định việc các phase sau không phải sửa code cũ.

### `config/taskflow.php`

```php
<?php
return [
    'queue_driver'   => env('TASKFLOW_QUEUE_DRIVER', 'database'),
    'event_driver'   => env('TASKFLOW_EVENT_DRIVER', 'log'),
    'storage_driver' => env('TASKFLOW_STORAGE_DRIVER', 'local'),
    // Dotenv biến chữ null không có nháy trong .env thành PHP null, không phải
    // chuỗi 'null' -> dùng ?: để lấy lại giá trị mặc định.
    'metrics_driver' => env('TASKFLOW_METRICS_DRIVER') ?: 'null',

    'queues' => [
        'jobs'              => env('TASKFLOW_QUEUE_JOBS', 'taskflow-jobs'),
        'jobs_dlq'          => env('TASKFLOW_QUEUE_JOBS_DLQ', 'taskflow-jobs-dlq'),
        'notifications'     => env('TASKFLOW_QUEUE_NOTIFICATIONS', 'taskflow-notifications'),
    ],

    'visibility_timeout' => (int) env('TASKFLOW_VISIBILITY_TIMEOUT', 180),
    'max_receive_count'  => (int) env('TASKFLOW_MAX_RECEIVE_COUNT', 3),
    'worker_timeout'     => (int) env('TASKFLOW_WORKER_TIMEOUT', 150),
    'heartbeat_interval' => (int) env('TASKFLOW_HEARTBEAT_INTERVAL', 60),

    'aws' => [
        'region'     => env('AWS_DEFAULT_REGION', 'us-east-1'),
        'account_id' => env('AWS_ACCOUNT_ID'),
    ],
];
```

### Exception

Ba class này quyết định toàn bộ cách hệ thống xử lý lỗi, và mọi tầng phía sau đều dùng — DTO ở ngay dưới, handler ở 1.8, processor ở 1.9. Viết trước tiên.

`app/Exceptions/RetryableException.php`:

```php
namespace App\Exceptions;

use RuntimeException;

/** Lỗi tạm thời — KHÔNG xóa message, để nó quay lại sau visibility timeout */
class RetryableException extends RuntimeException {}
```

`app/Exceptions/NonRetryableException.php`:

```php
namespace App\Exceptions;

use RuntimeException;

/** Lỗi vĩnh viễn — XÓA message ngay, retry không giúp được gì */
class NonRetryableException extends RuntimeException {}
```

`app/Exceptions/JobCancelledException.php`:

```php
namespace App\Exceptions;

use RuntimeException;

/** Người dùng bấm Cancel — XÓA message, status = cancelled */
class JobCancelledException extends RuntimeException {}
```

Phân biệt retryable và non-retryable là điều quan trọng nhất trong xử lý lỗi: một bên để message quay lại và cuối cùng vào DLQ, một bên xóa ngay để DLQ chỉ chứa những job thật sự đáng xem lại. Xem [thiết kế mục 13](../taskflow_cloud_design.md).

> Đặt ở `App\Exceptions` chứ không phải `App\Queue`: đây là exception nghiệp vụ của job, dùng chung cho cả DTO, handler và processor — không phải chi tiết riêng của tầng hàng đợi.

### DTO

`app/Queue/JobMessage.php` — message gửi đi:

```php
final class JobMessage implements JsonSerializable
{
    public function __construct(
        public readonly string $jobId,      // ULID
        public readonly string $jobType,
        public readonly array  $payload,
        public readonly int    $requestedBy,
        public readonly string $priority = 'normal',
        public readonly int    $messageVersion = 1,
    ) {}

    public function jsonSerialize(): array
    {
        return [
            'message_version' => $this->messageVersion,
            'job_id'          => $this->jobId,
            'job_type'        => $this->jobType,
            'priority'        => $this->priority,
            'payload'         => $this->payload,
            'requested_by'    => $this->requestedBy,
            'created_at'      => now()->toIso8601String(),
        ];
    }

    public static function fromArray(array $data): self
    {
        if (($data['message_version'] ?? 0) !== 1) {
            throw new NonRetryableException('Unsupported message_version');
        }
        return new self(
            jobId:       $data['job_id'],
            jobType:     $data['job_type'],
            payload:     $data['payload'] ?? [],
            requestedBy: $data['requested_by'],
            priority:    $data['priority'] ?? 'normal',
        );
    }
}
```

`app/Queue/ReceivedMessage.php` — message nhận về:

```php
final class ReceivedMessage
{
    public function __construct(
        public readonly string $receiptHandle,
        public readonly int    $receiveCount,
        public readonly array  $body,
    ) {}

    public function toJobMessage(): JobMessage
    {
        return JobMessage::fromArray($this->body);
    }
}
```

### Interface `app/Contracts/JobQueue.php`

```php
interface JobQueue
{
    public function send(string $queue, JobMessage $message): void;

    /** Trả về null nếu hết thời gian chờ mà không có message. */
    public function receive(string $queue, int $waitSeconds = 20): ?ReceivedMessage;

    public function delete(string $queue, ReceivedMessage $message): void;

    /** Đặt lại visibility timeout. 0 = trả message về queue ngay lập tức. */
    public function changeVisibility(string $queue, ReceivedMessage $message, int $seconds): void;

    /** Số message đang chờ — dùng cho dashboard. */
    public function approximateSize(string $queue): int;
}
```

Bốn method này ánh xạ 1-1 với API của SQS: `SendMessage`, `ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`. Đó là lý do Phase 2 không phải sửa gì.

### Các interface còn lại

`app/Contracts/EventEmitter.php`:

```php
interface EventEmitter {
    public function emit(string $event, string $jobId, array $context = []): void;
}
```

`app/Contracts/ResultStorage.php`:

```php
interface ResultStorage {
    public function put(string $key, string $contents): string;   // trả về key
    public function temporaryUrl(string $key, int $minutes = 15): string;
}
```

`app/Contracts/Metrics.php`:

```php
interface Metrics {
    public function count(string $name, int $value = 1, array $dimensions = []): void;
    public function timing(string $name, int $milliseconds, array $dimensions = []): void;
}
```

### Implementation cho Phase 1

Ba cái này rất ngắn. Mỗi implementation nằm trong thư mục theo lĩnh vực của nó, không nằm cạnh interface — nhờ vậy Phase 2/3/6/7 chỉ việc thêm file mới bên cạnh.

`app/Events/Emitters/LogEventEmitter.php`:

```php
final class LogEventEmitter implements EventEmitter {
    public function emit(string $event, string $jobId, array $context = []): void {
        Log::info('event.emitted', ['event' => $event, 'job_id' => $jobId] + $context);
    }
}
```

`app/Metrics/NullMetrics.php`:

```php
final class NullMetrics implements Metrics {
    public function count(string $n, int $v = 1, array $d = []): void {}
    public function timing(string $n, int $ms, array $d = []): void {}
}
```

`app/Storage/LocalResultStorage.php`:

```php
final class LocalResultStorage implements ResultStorage {
    public function put(string $key, string $contents): string {
        Storage::disk('local')->put($key, $contents);
        return $key;
    }
    public function temporaryUrl(string $key, int $minutes = 15): string {
        return url("/api/files/{$key}");   // Phase 3 đổi thành pre-signed S3 URL
    }
}
```

Còn thiếu duy nhất một implementation: `JobQueue`. Đó là nội dung mục tiếp theo. Có đủ cả bốn rồi mới đấu dây vào container ở 1.7.

---

## 1.6. `DatabaseJobQueue` — mô phỏng SQS

Đây là class thú vị nhất Phase 1. Đọc kỹ, vì nó dạy bạn chính xác SQS làm gì.

```php
final class DatabaseJobQueue implements JobQueue
{
    public function send(string $queue, JobMessage $message): void
    {
        DB::table('job_queue_messages')->insert([
            'queue_name' => $queue,
            'body'       => json_encode($message),
            'visible_at' => now(),          // visible ngay
            'created_at' => now(),
        ]);
    }

    public function receive(string $queue, int $waitSeconds = 20): ?ReceivedMessage
    {
        $deadline   = microtime(true) + $waitSeconds;
        $visibility = config('taskflow.visibility_timeout');
        $maxReceive = config('taskflow.max_receive_count');

        do {
            $row = DB::transaction(function () use ($queue, $visibility, $maxReceive) {
                // lockForUpdate: hai worker cùng chạy sẽ không lấy trùng cùng một dòng.
                // SQS làm việc này ở phía server, ta phải tự làm bằng row lock.
                $row = DB::table('job_queue_messages')
                    ->where('queue_name', $queue)
                    ->where('visible_at', '<=', now())
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->first();

                if (! $row) {
                    return null;
                }

                $newCount = $row->receive_count + 1;

                // Redrive: SQS kiểm tra ĐÚNG ở thời điểm nhận, không phải lúc thất bại.
                if ($newCount > $maxReceive) {
                    DB::table('job_queue_messages')->where('id', $row->id)->update([
                        'queue_name'    => $queue . '-dlq',
                        'receive_count' => 0,
                        'visible_at'    => now(),
                        'receipt_handle'=> null,
                    ]);
                    return 'moved';   // thử lại vòng lặp để lấy message kế tiếp
                }

                $handle = (string) Str::uuid();

                DB::table('job_queue_messages')->where('id', $row->id)->update([
                    'receipt_handle' => $handle,
                    'receive_count'  => $newCount,
                    'visible_at'     => now()->addSeconds($visibility),  // GIẤU message đi
                ]);

                $row->receipt_handle = $handle;
                $row->receive_count  = $newCount;
                return $row;
            });

            if ($row === 'moved') {
                continue;
            }

            if ($row) {
                return new ReceivedMessage(
                    receiptHandle: $row->receipt_handle,
                    receiveCount:  $row->receive_count,
                    body:          json_decode($row->body, true),
                );
            }

            // Long polling: chờ thay vì trả về ngay và để worker quay vòng liên tục
            if ($waitSeconds > 0) {
                usleep(500_000);
            }
        } while (microtime(true) < $deadline);

        return null;
    }

    public function delete(string $queue, ReceivedMessage $message): void
    {
        DB::table('job_queue_messages')
            ->where('queue_name', $queue)
            ->where('receipt_handle', $message->receiptHandle)   // đúng receipt của lần nhận này
            ->delete();
    }

    public function changeVisibility(string $queue, ReceivedMessage $message, int $seconds): void
    {
        DB::table('job_queue_messages')
            ->where('queue_name', $queue)
            ->where('receipt_handle', $message->receiptHandle)
            ->update(['visible_at' => now()->addSeconds($seconds)]);
    }

    public function approximateSize(string $queue): int
    {
        return DB::table('job_queue_messages')
            ->where('queue_name', $queue)
            ->where('visible_at', '<=', now())
            ->count();
    }
}
```

**Ba điều rút ra, áp dụng nguyên vẹn cho SQS thật:**

1. Nhận message **không xóa** nó — chỉ giấu đi trong `visibility_timeout` giây.
2. Không gọi `delete()` = message tự quay lại. Đây là toàn bộ cơ chế retry, không cần code retry.
3. `receive_count` tăng ở **mỗi lần nhận**, và redrive kiểm tra lúc nhận. Vượt ngưỡng → sang DLQ.

---

## 1.7. Service provider — nối driver vào container

Đủ bốn implementation rồi, giờ mới đấu dây được.

`app/Providers/TaskFlowServiceProvider.php`:

```php
public function register(): void
{
    $this->app->bind(JobQueue::class, fn () => match (config('taskflow.queue_driver')) {
        'database' => new DatabaseJobQueue(),
        // 'sqs'      => new SqsJobQueue(),       // Phase 2
    });

    $this->app->bind(EventEmitter::class, fn () => match (config('taskflow.event_driver')) {
        'log' => new LogEventEmitter(),
        // 'sqs' => new SqsEventEmitter(),        // Phase 6
    });

    $this->app->bind(ResultStorage::class, fn () => match (config('taskflow.storage_driver')) {
        'local' => new LocalResultStorage(),
        // 's3'    => new S3ResultStorage(),      // Phase 3
    });

    $this->app->bind(Metrics::class, fn () => match (config('taskflow.metrics_driver')) {
        'null' => new NullMetrics(),
        // 'emf'  => new EmfMetrics(),            // Phase 7
    });
}
```

Đăng ký provider vào mảng `providers` trong `config/app.php`:

```php
App\Providers\TaskFlowServiceProvider::class,
```

> Các nhánh `match` của phase sau để nguyên dạng comment. Mở comment ra khi nào file implementation tương ứng đã tồn tại — `match` đánh giá lười, nhưng PHP vẫn phải nạp được class khi nhánh đó chạy, và quan trọng hơn là để tài liệu này khớp với code chạy được ở mọi thời điểm.

Kiểm tra nhanh — lệnh này resolve cả bốn binding, chạy trót lọt nghĩa là đấu dây đúng:

```bash
php artisan tinker --execute="dump(get_class(app(App\Contracts\JobQueue::class)), get_class(app(App\Contracts\EventEmitter::class)), get_class(app(App\Contracts\ResultStorage::class)), get_class(app(App\Contracts\Metrics::class)));"
```

**Từ đây trở đi, chuyển phase = sửa `.env`.** Không sửa code nghiệp vụ.

---

## 1.8. Handler cho từng loại job

`app/Contracts/JobHandler.php`:

```php
interface JobHandler
{
    /** @return array Kết quả lưu vào result_json */
    public function handle(JobMessage $message, JobContext $ctx): array;
}
```

`app/Jobs/JobContext.php` cho handler báo tiến độ và kiểm tra hủy:

```php
final class JobContext
{
    public function __construct(
        private readonly Job $job,
        private readonly ResultStorage $storage,
    ) {}

    public function progress(int $percent): void
    {
        $this->job->update(['progress' => min(100, max(0, $percent))]);
    }

    /** Handler gọi định kỳ; ném exception nếu người dùng đã bấm Cancel. */
    public function checkCancelled(): void
    {
        if ($this->job->fresh()->cancel_requested) {
            throw new JobCancelledException();
        }
    }

    public function storeResult(string $filename, string $contents): string
    {
        return $this->storage->put("results/{$this->job->ulid}/{$filename}", $contents);
    }
}
```

### `SimulateWorkHandler` — quan trọng nhất cho việc load test

```php
final class SimulateWorkHandler implements JobHandler
{
    public function handle(JobMessage $message, JobContext $ctx): array
    {
        $duration = (int)   ($message->payload['duration_seconds'] ?? 10);
        $failProb = (float) ($message->payload['failure_probability'] ?? 0.0);
        $failType = (string)($message->payload['failure_type'] ?? 'retryable');

        for ($i = 1; $i <= $duration; $i++) {
            sleep(1);
            $ctx->progress((int) ($i / $duration * 100));
            $ctx->checkCancelled();     // phản hồi lệnh Cancel trong vòng 1 giây
        }

        if (mt_rand() / mt_getrandmax() < $failProb) {
            throw $failType === 'retryable'
                ? new RetryableException('Simulated transient failure')
                : new NonRetryableException('Simulated permanent failure');
        }

        return ['simulated' => true, 'duration_seconds' => $duration];
    }
}
```

### `GenerateReportHandler`

```php
final class GenerateReportHandler implements JobHandler
{
    public function handle(JobMessage $message, JobContext $ctx): array
    {
        $count  = (int) ($message->payload['record_count'] ?? 1000);
        $format = $message->payload['format'] ?? 'csv';

        $rows = [];
        for ($i = 1; $i <= $count; $i++) {
            $rows[] = [$i, "Record {$i}", mt_rand(1, 1000), now()->toDateString()];
            if ($i % 500 === 0) {
                $ctx->progress((int) ($i / $count * 100));
                $ctx->checkCancelled();
            }
        }

        $csv = "id,name,value,date\n";
        foreach ($rows as $r) { $csv .= implode(',', $r) . "\n"; }

        $key = $ctx->storeResult("report.{$format}", $csv);

        return ['record_count' => $count, 'result_key' => $key];
    }
}
```

### `SendEmailHandler`

`app/Jobs/Handlers/SendEmailHandler.php`. Ở Phase 1 `MAIL_MAILER=log` nên mail chỉ ghi vào `storage/logs/laravel.log` — đủ để kiểm chứng luồng. Phase 5 đổi sang SES mà không phải sửa handler.

```php
final class SendEmailHandler implements JobHandler
{
    public function handle(JobMessage $message, JobContext $ctx): array
    {
        $to      = $message->payload['to']      ?? null;
        $subject = $message->payload['subject'] ?? 'TaskFlow notification';
        $body    = $message->payload['body']    ?? '';

        // Địa chỉ sai thì gửi lại 3 lần cũng sai y hệt -> lỗi vĩnh viễn
        if (! $to || ! filter_var($to, FILTER_VALIDATE_EMAIL)) {
            throw new NonRetryableException("Địa chỉ email không hợp lệ: " . var_export($to, true));
        }

        $ctx->progress(50);

        Mail::raw($body, fn ($mail) => $mail->to($to)->subject($subject));

        return ['to' => $to, 'subject' => $subject, 'sent_at' => now()->toIso8601String()];
    }
}
```

### Registry

`app/Jobs/HandlerRegistry.php`:

```php
final class HandlerRegistry
{
    private array $map = [
        'simulate_work'   => SimulateWorkHandler::class,
        'generate_report' => GenerateReportHandler::class,
        'send_email'      => SendEmailHandler::class,
    ];

    public function resolve(string $jobType): JobHandler
    {
        if (! isset($this->map[$jobType])) {
            // Lỗi vĩnh viễn: retry 3 lần cũng không làm job_type này tồn tại
            throw new NonRetryableException("Unknown job_type: {$jobType}");
        }
        return app($this->map[$jobType]);
    }
}
```

Ba handler đều chỉ ném exception rồi trả về mảng kết quả — chúng không biết gì về queue, về retry, về DLQ. Toàn bộ phần đó là việc của `JobProcessor` ở mục sau. Thêm một `job_type` mới về sau chỉ là viết một class và thêm một dòng vào `$map`.

---

## 1.9. `Outcome`, `JobDispatcher` và `JobProcessor`

### `Outcome` — kết luận của processor về số phận message

Viết trước vì cả `JobProcessor` ngay dưới lẫn consumer ở 1.10 đều dùng.

`app/Queue/Outcome.php`:

```php
namespace App\Queue;

enum Outcome
{
    case Delete;   // xóa message khỏi queue
    case Keep;     // để nguyên, chờ visibility timeout hết hạn rồi nhận lại
    case Retry;    // như Keep nhưng chủ động rút ngắn/kéo dài bằng backoff

    public static function delete(): self { return self::Delete; }
    public static function keep(): self   { return self::Keep; }
    public static function retry(): self  { return self::Retry; }

    public function isDelete(): bool { return $this === self::Delete; }
    public function isRetry(): bool  { return $this === self::Retry; }
}
```

> Processor **không** tự gọi `$queue->delete()`. Nó chỉ trả về kết luận, còn consumer ở 1.10 mới thao tác lên queue. Tách như vậy thì processor test được bằng unit test thuần, không cần queue thật.

### `JobDispatcher` — phía API

`app/Jobs/JobDispatcher.php`:

```php
final class JobDispatcher
{
    public function __construct(private readonly JobQueue $queue) {}

    public function dispatch(User $user, string $type, array $payload, string $priority = 'normal'): Job
    {
        $job = DB::transaction(fn () => Job::create([
            'ulid'         => (string) Str::ulid(),
            'user_id'      => $user->id,
            'type'         => $type,
            'status'       => 'queued',      // KHÔNG có trạng thái pending
            'priority'     => $priority,
            'payload_json' => $payload,
            'notify'       => $payload['notify'] ?? true,
            'queued_at'    => now(),
        ]));

        // afterCommit: chỉ gửi message SAU KHI transaction đã commit.
        // Nếu gửi trước, worker có thể nhận message và query DB trước khi
        // dữ liệu nhìn thấy được -> "job không tồn tại". Race condition này
        // xảy ra thật, không phải trên lý thuyết.
        DB::afterCommit(fn () => $this->queue->send(
            config('taskflow.queues.jobs'),
            new JobMessage(
                jobId:       $job->ulid,
                jobType:     $job->type,
                payload:     $payload,
                requestedBy: $user->id,
                priority:    $priority,
            )
        ));

        return $job;
    }

    /**
     * Gửi lại message cho một job đã tồn tại — dùng cho Retry (1.11)
     * và cho command requeue-orphans bên dưới.
     */
    public function redispatch(Job $job): void
    {
        $this->queue->send(
            config('taskflow.queues.jobs'),
            new JobMessage(
                jobId:       $job->ulid,
                jobType:     $job->type,
                payload:     $job->payload_json ?? [],
                requestedBy: $job->user_id,
                priority:    $job->priority,
            )
        );
    }
}
```

> Trường hợp lỗi còn lại: DB commit xong nhưng `send()` thất bại → job kẹt ở `queued` mãi mãi. Phase 6 sẽ có Maintenance Lambda quét và gửi lại; ở Phase 1 ta làm bằng một command.

`app/Console/Commands/RequeueOrphans.php`:

```php
class RequeueOrphans extends Command
{
    protected $signature   = 'taskflow:requeue-orphans {--minutes=5 : Job queued lâu hơn ngần này thì coi là mồ côi}';
    protected $description = 'Gửi lại message cho các job kẹt ở trạng thái queued';

    public function handle(JobDispatcher $dispatcher): int
    {
        $cutoff = now()->subMinutes((int) $this->option('minutes'));

        Job::where('status', 'queued')
            ->where('queued_at', '<', $cutoff)
            ->chunkById(100, function ($jobs) use ($dispatcher) {
                foreach ($jobs as $job) {
                    $dispatcher->redispatch($job);
                    $this->line("requeued {$job->ulid}");
                }
            });

        return self::SUCCESS;
    }
}
```

> Gửi lại có thể tạo message trùng cho job đã thực sự nằm trong queue. Không sao: compare-and-set ở `JobProcessor` ngay dưới khiến bản trùng bị bỏ qua và xóa. Đây chính là lý do phải thiết kế idempotent ngay từ đầu.

### `JobProcessor` — phía worker

Đây là trái tim của hệ thống.

```php
final class JobProcessor
{
    public function __construct(
        private readonly JobQueue        $queue,
        private readonly HandlerRegistry $handlers,
        private readonly EventEmitter    $events,
        private readonly Metrics         $metrics,
        private readonly ResultStorage   $storage,
    ) {}

    public function process(string $queueName, ReceivedMessage $received): Outcome
    {
        $msg   = $received->toJobMessage();
        $jobId = $msg->jobId;

        $job = Job::where('ulid', $jobId)->first();

        // Job chưa nhìn thấy trong DB -> có thể transaction chưa commit xong.
        // KHÔNG xóa message; để nó quay lại sau visibility timeout.
        if (! $job) {
            Log::warning('job.not_found', ['job_id' => $jobId]);
            return Outcome::keep();
        }

        if ($job->status === 'completed') {
            return Outcome::delete();               // idempotency: đã xong rồi
        }

        if ($job->cancel_requested) {
            $job->update(['status' => 'cancelled']);
            return Outcome::delete();
        }

        // ===== Compare-and-set: giành quyền xử lý một cách nguyên tử =====
        // Chỉ MỘT worker có thể làm câu UPDATE này thành công.
        // Điều kiện heartbeat cho phép giành lại job từ worker đã chết.
        $claimed = DB::update(<<<'SQL'
            UPDATE jobs
            SET    status = 'processing',
                   started_at = COALESCE(started_at, NOW()),
                   heartbeat_at = NOW(),
                   attempts = attempts + 1
            WHERE  ulid = ?
              AND  cancel_requested = 0
              AND  (
                     status = 'queued'
                     OR (status = 'processing' AND heartbeat_at < NOW() - INTERVAL 5 MINUTE)
                   )
        SQL, [$jobId]);

        if ($claimed === 0) {
            // Worker khác đang giữ và còn sống, hoặc job đã ở trạng thái cuối.
            Log::info('job.already_claimed', ['job_id' => $jobId]);
            return Outcome::delete();
        }

        $job->refresh();
        $started = microtime(true);

        // firstOrCreate + UNIQUE(job_id, attempt): nếu message bị giao trùng
        // trong cùng một lần nhận thì không tạo execution thứ hai.
        $execution = JobExecution::firstOrCreate(
            ['job_id' => $job->id, 'attempt' => $received->receiveCount],
            [
                'worker_id'          => gethostname(),
                'sqs_receipt_handle' => substr($received->receiptHandle, 0, 1024),
                'status'             => 'running',
                'started_at'         => now(),
            ],
        );

        try {
            $handler = $this->handlers->resolve($msg->jobType);
            $result  = $handler->handle($msg, new JobContext($job, $this->storage));

            $ms = (int) ((microtime(true) - $started) * 1000);

            DB::transaction(function () use ($job, $execution, $result, $ms) {
                $job->update([
                    'status'       => 'completed',
                    'progress'     => 100,
                    'result_json'  => $result,
                    'completed_at' => now(),
                ]);
                $execution->update([
                    'status'      => 'completed',
                    'finished_at' => now(),
                    'duration_ms' => $ms,
                ]);
            });

            // Thứ tự bắt buộc: cập nhật DB -> phát event -> XÓA message sau cùng.
            // Nếu worker chết giữa chừng, message quay lại, worker mới thấy
            // status=completed và xóa nó. An toàn.
            $this->events->emit('job.completed', $jobId, ['duration_ms' => $ms]);
            $this->metrics->count('JobSuccessCount', 1, ['JobType' => $msg->jobType]);
            $this->metrics->timing('JobDuration', $ms, ['JobType' => $msg->jobType]);

            return Outcome::delete();

        } catch (JobCancelledException) {
            $job->update(['status' => 'cancelled']);
            $execution->update(['status' => 'failed', 'error_code' => 'cancelled', 'finished_at' => now()]);
            return Outcome::delete();

        } catch (NonRetryableException $e) {
            // Lỗi vĩnh viễn: retry 3 lần cũng hỏng y hệt. Xóa luôn, không làm bẩn DLQ.
            $this->fail($job, $execution, $e, 'permanent');
            $this->events->emit('job.failed', $jobId, ['permanent' => true]);
            return Outcome::delete();

        } catch (Throwable $e) {
            // Lỗi tạm thời: KHÔNG xóa message -> nó tự quay lại -> sau 3 lần vào DLQ.
            $this->fail($job, $execution, $e, 'transient');
            return Outcome::retry();
        }
    }

    private function fail(Job $job, JobExecution $exec, Throwable $e, string $kind): void
    {
        $permanent = $kind === 'permanent';
        $job->update([
            'status'        => $permanent ? 'failed' : 'queued',   // transient -> chờ nhận lại
            'error_code'    => $permanent ? 'permanent_error' : 'transient_error',
            'error_message' => Str::limit($e->getMessage(), 1000),
            'failed_at'     => $permanent ? now() : null,
        ]);
        $exec->update([
            'status'        => 'failed',
            'finished_at'   => now(),
            'error_code'    => $permanent ? 'permanent_error' : 'transient_error',
            'error_message' => Str::limit($e->getMessage(), 1000),
        ]);
        $this->metrics->count('JobFailureCount', 1, ['JobType' => $job->type]);
        Log::error('job.failed', ['job_id' => $job->ulid, 'kind' => $kind, 'error' => $e->getMessage()]);
    }
}
```

Ba nhánh `catch` cuối chính là toàn bộ chính sách lỗi của hệ thống, và mỗi nhánh trả về một `Outcome` khác nhau. Consumer ở mục sau chỉ việc thi hành kết luận đó.

---

## 1.10. Consumer command

`app/Console/Commands/ConsumeQueue.php`:

```php
class ConsumeQueue extends Command
{
    protected $signature = 'taskflow:consume
                            {--queue= : Tên queue}
                            {--once : Chỉ xử lý 1 message rồi thoát}
                            {--max-runtime=0 : Giây, 0 = chạy mãi}';

    private bool $shouldStop = false;

    public function handle(JobQueue $queue, JobProcessor $processor): int
    {
        $queueName = $this->option('queue') ?: config('taskflow.queues.jobs');

        // ===== Graceful shutdown =====
        // ECS gửi SIGTERM khi scale in hoặc deploy, rồi chờ stopTimeout giây
        // mới SIGKILL. Không xử lý tín hiệu này thì job đang chạy bị giết ngang.
        // Phase 4 phụ thuộc hoàn toàn vào đoạn code này.
        pcntl_async_signals(true);
        pcntl_signal(SIGTERM, function () {
            $this->shouldStop = true;
            $this->info('SIGTERM nhận được — ngừng nhận message mới, xử lý nốt việc đang làm');
        });
        pcntl_signal(SIGINT, fn () => $this->shouldStop = true);

        $this->info("Worker khởi động | queue={$queueName} | host=" . gethostname());
        $started = time();

        while (! $this->shouldStop) {
            $maxRuntime = (int) $this->option('max-runtime');
            if ($maxRuntime > 0 && time() - $started > $maxRuntime) {
                break;
            }

            $message = $queue->receive($queueName, waitSeconds: 20);

            if (! $message) {
                continue;   // long polling hết hạn, không có việc
            }

            $outcome = $processor->process($queueName, $message);

            match (true) {
                $outcome->isDelete() => $queue->delete($queueName, $message),
                $outcome->isRetry()  => $queue->changeVisibility(
                    $queueName, $message, $this->backoffSeconds($message->receiveCount)
                ),
                default              => null,   // keep: không làm gì, chờ visibility hết hạn
            };

            if ($this->option('once')) {
                break;
            }
        }

        $this->info('Worker đã dừng sạch sẽ');
        return self::SUCCESS;
    }

    /** Backoff tăng dần — SQS không tự làm việc này. */
    private function backoffSeconds(int $attempt): int
    {
        return match ($attempt) {
            1       => 30,
            2       => 120,
            default => 300,
        };
    }
}
```

Chạy worker:

```bash
php artisan taskflow:consume
```

> ⚠️ `pcntl` không có trên Windows. Ở Phase 1 trên Windows, bọc bằng `if (function_exists('pcntl_async_signals'))`. Đến Phase 3 worker chạy trong container Linux nên sẽ hoạt động đầy đủ — nhớ cài extension `pcntl` trong Dockerfile.

---

## 1.11. REST API

### Auth — Sanctum token

Package đã cài và `User` đã có `HasApiTokens` từ 1.4, giờ chỉ còn bật middleware. Trong `app/Http/Kernel.php`, nhóm `api`:

```php
'api' => [
    \Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful::class,
    \Illuminate\Routing\Middleware\SubstituteBindings::class,
],
```

> 💡 **Vì sao token chứ không phải cookie SPA:** Sanctum có 2 chế độ. Chế độ SPA dùng cookie, yêu cầu frontend và backend cùng domain cha — ở local chúng là `localhost:5173` và `localhost:8000`, tới Phase 8 lại đổi domain. Chế độ token không quan tâm domain, chỉ cần header `Authorization: Bearer ...`. Ít rắc rối CORS/CSRF hơn hẳn.

`routes/api.php`:

```php
Route::post('/auth/login',    [AuthController::class, 'login']);
Route::post('/auth/register', [AuthController::class, 'register']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me',      [AuthController::class, 'me']);

    Route::get('/jobs',              [JobController::class, 'index']);
    Route::post('/jobs',             [JobController::class, 'store']);
    Route::get('/jobs/{ulid}',       [JobController::class, 'show']);
    Route::post('/jobs/{ulid}/retry',  [JobController::class, 'retry']);
    Route::post('/jobs/{ulid}/cancel', [JobController::class, 'cancel']);

    Route::get('/dashboard/summary', [DashboardController::class, 'summary']);
    Route::post('/load-tests',       [LoadTestController::class, 'store']);

    Route::get('/dlq',                  [DlqController::class, 'index']);
    Route::post('/dlq/{ulid}/redrive',  [DlqController::class, 'redrive']);
});
```

### `JobController`

```php
public function store(StoreJobRequest $request, JobDispatcher $dispatcher)
{
    $job = $dispatcher->dispatch(
        user:     $request->user(),
        type:     $request->validated('type'),
        payload:  $request->validated('payload'),
        priority: $request->validated('priority', 'normal'),
    );

    // 202 Accepted, không phải 201 Created: công việc mới được NHẬN,
    // chưa hoàn thành. Đây là mã trạng thái đúng cho xử lý bất đồng bộ.
    return response()->json(new JobResource($job), 202);
}

public function cancel(string $ulid, Request $request)
{
    $job = Job::where('ulid', $ulid)->where('user_id', $request->user()->id)->firstOrFail();

    if (in_array($job->status, ['completed', 'failed', 'cancelled'])) {
        return response()->json(['message' => 'Job đã ở trạng thái cuối'], 422);
    }

    // SQS KHÔNG cho xóa một message cụ thể. Cancel chỉ có thể là cờ trong DB;
    // worker kiểm tra cờ này trước và trong khi xử lý.
    $job->update([
        'cancel_requested' => true,
        'status' => $job->status === 'processing' ? 'cancelling' : 'cancelled',
    ]);

    return response()->json(new JobResource($job->fresh()));
}

public function retry(string $ulid, Request $request, JobDispatcher $dispatcher)
{
    $job = Job::where('ulid', $ulid)->where('user_id', $request->user()->id)->firstOrFail();

    // KHÔNG "hồi sinh" message cũ — không làm được. Gửi một message MỚI.
    // job_executions cũ giữ nguyên làm lịch sử.
    $job->update([
        'status' => 'queued', 'cancel_requested' => false,
        'error_code' => null, 'error_message' => null,
        'progress' => 0, 'failed_at' => null, 'queued_at' => now(),
    ]);

    $dispatcher->redispatch($job);

    return response()->json(new JobResource($job->fresh()), 202);
}
```

### `LoadTestController`

```php
public function store(Request $request, JobDispatcher $dispatcher)
{
    $data = $request->validate([
        'count'               => 'required|integer|min:1|max:1000',
        'duration_seconds'    => 'required|integer|min:1|max:60',
        'failure_probability' => 'required|numeric|min:0|max:1',
        'failure_type'        => 'in:retryable,non_retryable',
    ]);

    $ulids = [];
    foreach (range(1, $data['count']) as $_) {
        $ulids[] = $dispatcher->dispatch($request->user(), 'simulate_work', [
            'duration_seconds'    => $data['duration_seconds'],
            'failure_probability' => $data['failure_probability'],
            'failure_type'        => $data['failure_type'] ?? 'retryable',
            'notify'              => false,   // BẮT BUỘC: bảo vệ hạn mức SES ở Phase 5
        ])->ulid;
    }

    return response()->json(['created' => count($ulids), 'job_ids' => $ulids], 202);
}
```

---

## 1.12. React Dashboard

> 📘 Phần dưới đây là bản tóm tắt. **Bản đầy đủ nằm ở [frontend-guide.md](frontend-guide.md)** — stack, cấu trúc thư mục theo feature, theme, phác thảo từng màn hình, và các mẫu UX riêng cho hệ thống bất đồng bộ.
>
> Hai điểm guide đó **thay thế** phần dưới đây:
> - **Ant Design v5** làm component library — không tự viết Modal/Table/Timeline (tiết kiệm 3–4 ngày).
> - **TanStack Query** thay cho hook `usePolling` tự viết — xử lý sẵn việc dừng poll khi tab ẩn, dừng khi mọi job đã xong, và không làm bảng chớp mỗi lần refetch.

### API client — viết một lần, dùng suốt 8 phase

`frontend/src/lib/api.ts`:

```ts
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api';

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
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error((await res.json()).message ?? `HTTP ${res.status}`);
  return res.json();
}

export const api = {
  login:  (email: string, password: string) =>
            request<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  jobs:   (params?: Record<string, string>) =>
            request<Paginated<Job>>(`/jobs?${new URLSearchParams(params)}`),
  job:    (ulid: string) => request<Job>(`/jobs/${ulid}`),
  create: (body: CreateJobBody) => request<Job>('/jobs', { method: 'POST', body: JSON.stringify(body) }),
  cancel: (ulid: string) => request<Job>(`/jobs/${ulid}/cancel`, { method: 'POST' }),
  retry:  (ulid: string) => request<Job>(`/jobs/${ulid}/retry`,  { method: 'POST' }),
  summary:() => request<Summary>('/dashboard/summary'),
  loadTest: (body: LoadTestBody) => request<{ created: number }>('/load-tests', { method: 'POST', body: JSON.stringify(body) }),
};
```

### Polling hook — dùng lại ở mọi phase

```ts
export function usePolling<T>(fn: () => Promise<T>, intervalMs = 3000, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    const tick = async () => {
      try { const d = await fn(); if (alive) setData(d); }
      catch (e) { if (alive) setError(e as Error); }
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [enabled, intervalMs]);

  return { data, error };
}
```

> 💡 **Vì sao polling chứ không WebSocket:** WebSocket cần thêm hạ tầng (API Gateway WebSocket hoặc một server riêng), tốn tiền và tốn thời gian. Job của ta chạy 5–30 giây nên cập nhật mỗi 3 giây là quá đủ. Ghi vào mục "mở rộng", không làm bây giờ.

### Các trang Phase 1

| Route | Nội dung |
|---|---|
| `/login` | Form đăng nhập, lưu token |
| `/jobs` | Bảng job: ULID, type, status badge, progress bar, thời gian. Polling 3s. Filter theo status |
| `/jobs/new` | Form chọn `job_type` + payload động theo type |
| `/jobs/:ulid` | Chi tiết: trạng thái, progress, result JSON, **timeline các execution attempt**, nút Cancel/Retry |
| `/load-test` | Form: count, duration, failure %, failure type. Nút Run |
| `/` | Dashboard: 4 thẻ số (queued / processing / completed / failed) + queue depth |

Component dùng chung viết một lần: `<JobStatusBadge>`, `<ProgressBar>`, `<DurationText>`, `<JsonViewer>`.

Trang `/jobs/:ulid` là trang giá trị nhất — timeline execution cho bạn thấy trực quan job đã bị nhận lại mấy lần và lỗi gì ở mỗi lần. Đây chính là thứ bạn sẽ nhìn suốt Phase 2 và Phase 4.

---

## 1.13. Kiểm thử Phase 1

Chạy 3 terminal: `php artisan serve`, `npm run dev`, `php artisan taskflow:consume`.

### Test 1 — Luồng thành công
Tạo job `simulate_work` 10 giây → xem progress bar chạy 10% mỗi giây → `completed`.

### Test 2 — Retry và DLQ (quan trọng nhất)
Tạo job với `failure_probability = 1.0`, `failure_type = retryable`.

Quan sát trong DB:
```sql
SELECT queue_name, receive_count, visible_at FROM job_queue_messages;
SELECT attempt, status, error_code FROM job_executions WHERE job_id = ?;
```

Kỳ vọng: message được nhận **đúng 3 lần**, tạo 3 execution, rồi `queue_name` đổi thành `taskflow-jobs-dlq`.

Với backoff, tổng thời gian là 30s + 120s + 300s ≈ 7.5 phút. Muốn test nhanh, tạm đặt `TASKFLOW_VISIBILITY_TIMEOUT=10` và sửa `backoffSeconds` trả về 5.

### Test 3 — Lỗi vĩnh viễn
`failure_type = non_retryable` → **đúng 1** execution, `status = failed`, message bị xóa, **không** vào DLQ.

### Test 4 — Idempotency
Chạy **2 worker** cùng lúc ở 2 terminal. Tạo 20 job. Kiểm tra:
```sql
SELECT job_id, COUNT(*) FROM job_executions GROUP BY job_id HAVING COUNT(*) > 1;
```
Không job nào được xử lý 2 lần đồng thời. Log sẽ có `job.already_claimed` — đó là compare-and-set đang làm việc.

### Test 5 — Giành lại job từ worker chết
Tạo job 60 giây. Đang chạy thì `Ctrl+C` **cứng** worker (đóng luôn terminal). Chờ 5 phút → chạy worker mới → nó giành lại được job nhờ điều kiện `heartbeat_at < NOW() - INTERVAL 5 MINUTE`.

### Test 6 — Cancel
Tạo job 30 giây, bấm Cancel giữa chừng → dừng trong vòng ~1 giây, `status = cancelled`.

---

## Definition of Done — Phase 1

- [ ] `docker compose up -d` chạy, `php artisan migrate` thành công
- [ ] Đăng nhập được từ React, token lưu và dùng lại sau F5
- [ ] Tạo job từ UI, worker xử lý, progress bar cập nhật
- [ ] 3 job type đều chạy (`simulate_work`, `generate_report`, `send_email`)
- [ ] `generate_report` ghi được file ra `storage/app/results/`
- [ ] Test 2: job lỗi tạm thời được nhận **đúng 3 lần** rồi vào `taskflow-jobs-dlq`
- [ ] Test 3: job lỗi vĩnh viễn chỉ **1** execution, không vào DLQ
- [ ] Test 4: 2 worker chạy song song, không job nào xử lý trùng
- [ ] Test 5: giành lại được job từ worker đã chết
- [ ] Test 6: Cancel dừng job trong vòng 2 giây
- [ ] Load test 100 job chạy hết không lỗi
- [ ] Trang `/jobs/:ulid` hiển thị đủ timeline execution
- [ ] `git commit` — Phase 1 hoàn chỉnh

> Quan trọng: **tick hết mới sang Phase 2**. Phase 2 chỉ đổi driver — nếu logic còn sai ở đây thì lên AWS bạn sẽ debug qua CloudWatch Logs với vòng lặp 15 phút thay vì 15 giây.

**→ Tiếp theo: [Phase 2 — SQS](phase-2-sqs.md)**
