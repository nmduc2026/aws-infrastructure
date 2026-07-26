<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreJobRequest;
use App\Http\Resources\JobResource;
use App\Jobs\JobDispatcher;
use App\Models\Job;
use Illuminate\Http\Request;

class JobController extends Controller
{
    public function store(StoreJobRequest $request, JobDispatcher $dispatcher)
    {
        $job = $dispatcher->dispatch(
            user: $request->user(),
            type: $request->validated('type'),
            payload: $request->validated('payload'),
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
            'status' => 'queued',
            'cancel_requested' => false,
            'error_code' => null,
            'error_message' => null,
            'progress' => 0,
            'failed_at' => null,
            'queued_at' => now(),
        ]);

        $dispatcher->redispatch($job);

        return response()->json(new JobResource($job->fresh()), 202);
    }
}
