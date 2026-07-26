<?php

namespace App\Contracts;

use App\Jobs\JobContext;
use App\Queue\JobMessage;

interface JobHandler
{
    /** @return array Kết quả lưu vào result_json */
    public function handle(JobMessage $message, JobContext $ctx): array;
}