<?php

namespace App\Jobs;

use App\Contracts\EventEmitter;
use App\Contracts\Metrics;
use App\Contracts\ResultStorage;
use App\Exceptions\JobCancelledException;
use App\Exceptions\NonRetryableException;
use App\Models\Job;
use App\Models\JobExecution;
use App\Queue\Outcome;
use App\Queue\ReceivedMessage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

final class JobProcessor
{
    // KHÔNG inject JobQueue: processor chỉ trả về Outcome, consumer mới thao tác
    // lên queue. Nhờ vậy class này unit test được bằng DB thuần, không cần queue.
    public function __construct(
        private readonly HandlerRegistry $handlers,
        private readonly EventEmitter    $events,
        private readonly Metrics         $metrics,
        private readonly ResultStorage   $storage,
    ) {}

    public function process(string $queueName, ReceivedMessage $received): Outcome
    {
        // Parse TRƯỚC mọi thứ khác và bắt lỗi ngay tại đây: message hỏng hoặc
        // sai message_version thì giao lại 100 lần cũng hỏng y hệt. Để lọt
        // exception ra ngoài là worker chết, message chưa xóa, khởi động lại
        // nhận đúng nó -> crash loop vĩnh viễn.
        try {
            $msg = $received->toJobMessage();
        } catch (NonRetryableException $e) {
            Log::error('message.invalid', ['error' => $e->getMessage()]);
            return Outcome::delete();
        }

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

        // attempt lấy từ jobs.attempts — câu CAS phía trên vừa tăng nó, nên số
        // này tăng đơn điệu suốt vòng đời job. KHÔNG dùng receive_count: Retry
        // gửi một message MỚI với receive_count reset về 1, sẽ đụng
        // UNIQUE(job_id, attempt) và ghi đè mất execution của lần chạy trước.
        $execution = JobExecution::firstOrCreate(
            ['job_id' => $job->id, 'attempt' => $job->attempts],
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
            $this->fail($job, $execution, $e, 'permanent', $received);
            $this->events->emit('job.failed', $jobId, ['permanent' => true]);
            return Outcome::delete();

        } catch (Throwable $e) {
            // Lỗi tạm thời: KHÔNG xóa message -> nó tự quay lại -> sau 3 lần vào DLQ.
            $this->fail($job, $execution, $e, 'transient', $received);
            return Outcome::retry();
        }
    }

    private function fail(
        Job $job,
        JobExecution $exec,
        Throwable $e,
        string $kind,
        ReceivedMessage $received,
    ): void {
        $permanent = $kind === 'permanent';

        // Đây là lần nhận cuối cùng: lần giao kế tiếp sẽ bị redrive sang DLQ và
        // job không bao giờ được xử lý nữa. Ghi trạng thái cuối NGAY BÂY GIỜ —
        // nếu để nguyên 'queued' thì job nằm trong DLQ mà dashboard vẫn đếm là
        // đang chờ, và requeue-orphans sẽ hồi sinh nó thành rác vô hạn.
        $exhausted = ! $permanent
            && $received->receiveCount >= (int) config('taskflow.max_receive_count');

        $status = match (true) {
            $permanent => 'failed',
            $exhausted => 'dead_lettered',
            default    => 'queued',   // transient -> chờ nhận lại
        };

        $job->update([
            'status'        => $status,
            'error_code'    => $permanent ? 'permanent_error' : 'transient_error',
            'error_message' => Str::limit($e->getMessage(), 1000),
            'failed_at'     => $status === 'queued' ? null : now(),
        ]);
        $exec->update([
            'status'        => 'failed',
            'finished_at'   => now(),
            'error_code'    => $permanent ? 'permanent_error' : 'transient_error',
            'error_message' => Str::limit($e->getMessage(), 1000),
        ]);
        $this->metrics->count('JobFailureCount', 1, ['JobType' => $job->type]);
        Log::error('job.failed', ['job_id' => $job->ulid, 'kind' => $kind, 'error' => $e->getMessage()]);

        if ($exhausted) {
            $this->events->emit('job.dead_lettered', $job->ulid, ['attempts' => $job->attempts]);
        }
    }
}