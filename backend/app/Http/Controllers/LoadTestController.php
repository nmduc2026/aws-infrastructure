<?php

namespace App\Http\Controllers;

use App\Jobs\JobDispatcher;
use Illuminate\Http\Request;

class LoadTestController extends Controller
{
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
}
