<?php

namespace App\Jobs\Handlers;

use App\Contracts\JobHandler;
use App\Exceptions\NonRetryableException;
use App\Exceptions\RetryableException;
use App\Jobs\JobContext;
use App\Queue\JobMessage;

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

        if ($failProb >= 1.0 || ($failProb > 0 && mt_rand() / mt_getrandmax() < $failProb)) {
            throw $failType === 'retryable'
                ? new RetryableException('Simulated transient failure')
                : new NonRetryableException('Simulated permanent failure');
        }

        return ['simulated' => true, 'duration_seconds' => $duration];
    }
}