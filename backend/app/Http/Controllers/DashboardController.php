<?php

namespace App\Http\Controllers;

use App\Contracts\JobQueue;
use App\Models\Job;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    public function summary(Request $request, JobQueue $queue)
    {
        $userId = $request->user()->id;

        return response()->json([
            'queued'      => Job::where('user_id', $userId)->where('status', 'queued')->count(),
            'processing'  => Job::where('user_id', $userId)->whereIn('status', ['processing', 'cancelling'])->count(),
            'completed'   => Job::where('user_id', $userId)->where('status', 'completed')->count(),
            'failed'      => Job::where('user_id', $userId)->whereIn('status', ['failed', 'dead_lettered'])->count(),
            'queue_depth' => $queue->approximateSize(config('taskflow.queues.jobs')),
        ]);
    }
}
