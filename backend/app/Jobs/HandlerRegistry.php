<?php

namespace App\Jobs;

use App\Contracts\JobHandler;
use App\Exceptions\NonRetryableException;
use App\Jobs\Handlers\GenerateReportHandler;
use App\Jobs\Handlers\SendEmailHandler;
use App\Jobs\Handlers\SimulateWorkHandler;

final class HandlerRegistry
{
    private array $map = [
        'simulate_work'   => SimulateWorkHandler::class,
        'generate_report' => GenerateReportHandler::class,
        'send_email'      => SendEmailHandler::class,
    ];

    public function resolve(string $jobType): JobHandler
    {
        if (! isset($this->map[$jobType])) {
            // Lỗi vĩnh viễn: retry 3 lần cũng không làm job_type này tồn tại
            throw new NonRetryableException("Unknown job_type: {$jobType}");
        }
        return app($this->map[$jobType]);
    }
}