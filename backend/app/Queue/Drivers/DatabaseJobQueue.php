<?php

namespace App\Queue\Drivers;

use App\Contracts\JobQueue;
use App\Queue\{JobMessage, ReceivedMessage};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class DatabaseJobQueue implements JobQueue
{
    public function send(string $queue, JobMessage $message): void
    {
        DB::table('job_queue_messages')->insert([
            'queue_name' => $queue,
            'body'       => json_encode($message),
            'visible_at' => now(),          // visible ngay
            'created_at' => now(),
        ]);
    }

    public function receive(string $queue, int $waitSeconds = 20): ?ReceivedMessage
    {
        $deadline   = microtime(true) + $waitSeconds;
        $visibility = config('taskflow.visibility_timeout');
        $maxReceive = config('taskflow.max_receive_count');

        do {
            $row = DB::transaction(function () use ($queue, $visibility, $maxReceive) {
                // lockForUpdate: hai worker cùng chạy sẽ không lấy trùng cùng một dòng.
                // SQS làm việc này ở phía server, ta phải tự làm bằng row lock.
                $row = DB::table('job_queue_messages')
                    ->where('queue_name', $queue)
                    ->where('visible_at', '<=', now())
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->first();

                if (! $row) {
                    return null;
                }

                $newCount = $row->receive_count + 1;

                // Redrive: SQS kiểm tra ĐÚNG ở thời điểm nhận, không phải lúc thất bại.
                if ($newCount > $maxReceive) {
                    DB::table('job_queue_messages')->where('id', $row->id)->update([
                        'queue_name'    => $this->dlqName($queue),
                        'receive_count' => 0,
                        'visible_at'    => now(),
                        'receipt_handle'=> null,
                    ]);
                    return 'moved';   // thử lại vòng lặp để lấy message kế tiếp
                }

                $handle = (string) Str::uuid();

                DB::table('job_queue_messages')->where('id', $row->id)->update([
                    'receipt_handle' => $handle,
                    'receive_count'  => $newCount,
                    'visible_at'     => now()->addSeconds($visibility),  // GIẤU message đi
                ]);

                $row->receipt_handle = $handle;
                $row->receive_count  = $newCount;
                return $row;
            });

            if ($row === 'moved') {
                continue;
            }

            if ($row) {
                return new ReceivedMessage(
                    receiptHandle: $row->receipt_handle,
                    receiveCount:  $row->receive_count,
                    body:          json_decode($row->body, true),
                );
            }

            // Long polling: chờ thay vì trả về ngay và để worker quay vòng liên tục
            if ($waitSeconds > 0) {
                usleep(500_000);
            }
        } while (microtime(true) < $deadline);

        return null;
    }

    public function delete(string $queue, ReceivedMessage $message): void
    {
        DB::table('job_queue_messages')
            ->where('queue_name', $queue)
            ->where('receipt_handle', $message->receiptHandle)   // đúng receipt của lần nhận này
            ->delete();
    }

    public function changeVisibility(string $queue, ReceivedMessage $message, int $seconds): void
    {
        DB::table('job_queue_messages')
            ->where('queue_name', $queue)
            ->where('receipt_handle', $message->receiptHandle)
            ->update(['visible_at' => now()->addSeconds($seconds)]);
    }

    /**
     * Tên DLQ tương ứng. Trên SQS đây là redrive policy gắn vào queue, ở đây ta
     * tra config trước để đổi tên trong .env có tác dụng thật, rồi mới suy ra
     * theo quy ước cho các queue chưa khai báo.
     */
    private function dlqName(string $queue): string
    {
        return $queue === config('taskflow.queues.jobs')
            ? config('taskflow.queues.jobs_dlq')
            : $queue . '-dlq';
    }

    public function approximateSize(string $queue): int
    {
        return DB::table('job_queue_messages')
            ->where('queue_name', $queue)
            ->where('visible_at', '<=', now())
            ->count();
    }
}