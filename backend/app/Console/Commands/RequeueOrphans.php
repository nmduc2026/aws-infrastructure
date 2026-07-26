<?php

namespace App\Console\Commands;

use App\Models\Job;
use App\Jobs\JobDispatcher;
use Illuminate\Console\Command;

class RequeueOrphans extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature   = 'taskflow:requeue-orphans {--minutes=5 : Job queued lâu hơn ngần này thì coi là mồ côi}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Gửi lại message cho các job kẹt ở trạng thái queued';

    /**
     * Execute the console command.
     */
    public function handle(JobDispatcher $dispatcher)
    {
        $cutoff = now()->subMinutes((int) $this->option('minutes'));

        // whereNull('error_code'): job vừa lỗi tạm thời cũng mang status 'queued'
        // nhưng message của nó vẫn nằm trong queue chờ backoff. Gửi lại là tạo
        // message trùng — chỉ vớt job thật sự chưa từng chạy lần nào.
        Job::where('status', 'queued')
            ->whereNull('error_code')
            ->where('queued_at', '<', $cutoff)
            ->chunkById(100, function ($jobs) use ($dispatcher) {
                foreach ($jobs as $job) {
                    $dispatcher->redispatch($job);
                    $this->line("requeued {$job->ulid}");
                }
            });

        return self::SUCCESS;
    }
}
