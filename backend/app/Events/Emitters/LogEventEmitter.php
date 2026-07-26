<?php

namespace App\Events\Emitters;

use App\Contracts\EventEmitter;
use Illuminate\Support\Facades\Log;

final class LogEventEmitter implements EventEmitter {
    public function emit(string $event, string $jobId, array $context = []): void {
        Log::info('event.emitted', ['event' => $event, 'job_id' => $jobId] + $context);
    }
}