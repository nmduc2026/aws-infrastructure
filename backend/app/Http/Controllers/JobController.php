<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreJobRequest;
use App\Http\Resources\JobResource;
use App\Jobs\JobDispatcher;
use App\Models\Job;
use Illuminate\Http\Request;

class JobController extends Controller
{
    public function index(Request $request)
    {
        $data = $request->validate([
            'status'   => 'nullable|string|max:20',
            'type'     => 'nullable|string|max:50',
            'per_page' => 'nullable|integer|min:1|max:100',
        ]);

        $jobs = Job::query()
            ->where('user_id', $request->user()->id)
            ->when($data['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($data['type'] ?? null, fn ($query, $type) => $query->where('type', $type))
            ->orderByDesc('created_at')
            ->paginate($data['per_page'] ?? 15);

        return JobResource::collection($jobs);
    }

    public function show(string $ulid, Request $request)
    {
        $job = Job::query()
            ->with(['executions' => fn ($query) => $query->orderBy('attempt')])
            ->where('ulid', $ulid)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        return new JobResource($job);
    }

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

        // Chỉ retry job đã kết thúc. Retry một job đang chạy sẽ đẩy thêm một
        // message trong khi worker cũ vẫn xử lý -> hai execution song song đè
        // progress và result của nhau.
        if (! in_array($job->status, ['failed', 'cancelled', 'dead_lettered'])) {
            return response()->json(['message' => 'Chỉ retry được job đã kết thúc'], 422);
        }

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
