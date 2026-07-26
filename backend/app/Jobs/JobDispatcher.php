<?php

namespace App\Jobs;

use App\Contracts\JobQueue;
use App\Models\Job;
use App\Models\User;
use App\Queue\JobMessage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

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