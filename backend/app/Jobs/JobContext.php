<?php

namespace App\Jobs;

use App\Contracts\ResultStorage;
use App\Exceptions\JobCancelledException;
use App\Models\Job;

final class JobContext
{
    public function __construct(
        private readonly Job $job,
        private readonly ResultStorage $storage,
    ) {}

    public function progress(int $percent): void
    {
        $this->job->update(['progress' => min(100, max(0, $percent))]);
    }

    /** Handler gọi định kỳ; ném exception nếu người dùng đã bấm Cancel. */
    public function checkCancelled(): void
    {
        if ($this->job->fresh()->cancel_requested) {
            throw new JobCancelledException();
        }
    }

    public function storeResult(string $filename, string $contents): string
    {
        return $this->storage->put("results/{$this->job->ulid}/{$filename}", $contents);
    }
}