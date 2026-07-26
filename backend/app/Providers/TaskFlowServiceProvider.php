<?php

namespace App\Providers;

use App\Contracts\EventEmitter;
use App\Contracts\JobQueue;
use App\Contracts\Metrics;
use App\Contracts\ResultStorage;
use App\Events\Emitters\LogEventEmitter;
use App\Metrics\NullMetrics;
use App\Queue\Drivers\DatabaseJobQueue;
use App\Storage\LocalResultStorage;
use Illuminate\Support\ServiceProvider;

class TaskFlowServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(JobQueue::class, fn() => match (config('taskflow.queue_driver')) {
            'database' => new DatabaseJobQueue(),
            // 'sqs'      => new SqsJobQueue(),       // Phase 2
        });

        $this->app->bind(EventEmitter::class, fn() => match (config('taskflow.event_driver')) {
            'log' => new LogEventEmitter(),
            // 'sqs' => new SqsEventEmitter(),        // Phase 6
        });

        $this->app->bind(ResultStorage::class, fn() => match (config('taskflow.storage_driver')) {
            'local' => new LocalResultStorage(),
            // 's3'    => new S3ResultStorage(),      // Phase 3
        });

        $this->app->bind(Metrics::class, fn() => match (config('taskflow.metrics_driver')) {
            'null' => new NullMetrics(),
            // 'emf'  => new EmfMetrics(),            // Phase 7
        });
    }
}
