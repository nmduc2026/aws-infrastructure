<?php

namespace App\Jobs\Handlers;

use App\Contracts\JobHandler;
use App\Jobs\JobContext;
use App\Queue\JobMessage;

final class GenerateReportHandler implements JobHandler
{
    public function handle(JobMessage $message, JobContext $ctx): array
    {
        $count  = (int) ($message->payload['record_count'] ?? 1000);
        $format = $message->payload['format'] ?? 'csv';

        $rows = [];
        for ($i = 1; $i <= $count; $i++) {
            $rows[] = [$i, "Record {$i}", mt_rand(1, 1000), now()->toDateString()];
            if ($i % 500 === 0) {
                $ctx->progress((int) ($i / $count * 100));
                $ctx->checkCancelled();
            }
        }

        $csv = "id,name,value,date\n";
        foreach ($rows as $r) { $csv .= implode(',', $r) . "\n"; }

        $key = $ctx->storeResult("report.{$format}", $csv);

        return ['record_count' => $count, 'result_key' => $key];
    }
}