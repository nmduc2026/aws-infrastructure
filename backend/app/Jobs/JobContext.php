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
        // heartbeat_at đi kèm progress: câu compare-and-set trong JobProcessor
        // dựa vào nó để biết worker còn sống. Không cập nhật thì job chạy quá
        // 5 phút sẽ bị worker khác giành mất ngay giữa chừng.
        $this->job->update([
            'progress'     => min(100, max(0, $percent)),
            'heartbeat_at' => now(),
        ]);
    }

    /** Handler gọi định kỳ; ném exception nếu người dùng đã bấm Cancel. */
    public function checkCancelled(): void
    {
        // Chỉ đọc đúng một cột — hàm này chạy mỗi giây trên mọi job đang xử lý,
        // hydrate cả model bằng fresh() là lãng phí thấy rõ khi load test.
        $cancelled = Job::where('id', $this->job->id)->value('cancel_requested');

        if ($cancelled) {
            throw new JobCancelledException();
        }
    }

    public function storeResult(string $filename, string $contents): string
    {
        return $this->storage->put("results/{$this->job->ulid}/{$filename}", $contents);
    }
}