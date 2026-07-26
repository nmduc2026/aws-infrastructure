<?php

namespace App\Console\Commands;

use App\Contracts\JobQueue;
use App\Jobs\JobProcessor;
use Illuminate\Console\Command;

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
        if(function_exists('pcntl_async_signals') && function_exists('pcntl_signal')) {
            pcntl_async_signals(true);
            pcntl_signal(SIGTERM, function () {
                $this->shouldStop = true;
                $this->info('SIGTERM nhận được — ngừng nhận message mới, xử lý nốt việc đang làm');
            });
            pcntl_signal(SIGINT, fn () => $this->shouldStop = true);
        }
        

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