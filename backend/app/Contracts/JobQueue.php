<?php

namespace App\Contracts;

use App\Queue\JobMessage;
use App\Queue\ReceivedMessage;

interface JobQueue
{
    public function send(string $queue, JobMessage $message): void;

    /** Trả về null nếu hết thời gian chờ mà không có message. */
    public function receive(string $queue, int $waitSeconds = 20): ?ReceivedMessage;

    public function delete(string $queue, ReceivedMessage $message): void;

    /** Đặt lại visibility timeout. 0 = trả message về queue ngay lập tức. */
    public function changeVisibility(string $queue, ReceivedMessage $message, int $seconds): void;

    /** Số message đang chờ — dùng cho dashboard. */
    public function approximateSize(string $queue): int;
}