<?php

namespace App\Jobs\Handlers;

use App\Contracts\JobHandler;
use App\Exceptions\NonRetryableException;
use App\Jobs\JobContext;
use App\Queue\JobMessage;
use Illuminate\Support\Facades\Mail;

final class SendEmailHandler implements JobHandler
{
    public function handle(JobMessage $message, JobContext $ctx): array
    {
        $to      = $message->payload['to']      ?? null;
        $subject = $message->payload['subject'] ?? 'TaskFlow notification';
        $body    = $message->payload['body']    ?? '';

        // Địa chỉ sai thì gửi lại 3 lần cũng sai y hệt -> lỗi vĩnh viễn
        if (! $to || ! filter_var($to, FILTER_VALIDATE_EMAIL)) {
            throw new NonRetryableException("Địa chỉ email không hợp lệ: " . var_export($to, true));
        }

        $ctx->progress(50);

        Mail::raw($body, fn ($mail) => $mail->to($to)->subject($subject));

        return ['to' => $to, 'subject' => $subject, 'sent_at' => now()->toIso8601String()];
    }
}