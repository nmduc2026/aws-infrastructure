<?php

namespace App\Queue;

enum Outcome
{
    case Delete;   // xóa message khỏi queue
    case Keep;     // để nguyên, chờ visibility timeout hết hạn rồi nhận lại
    case Retry;    // như Keep nhưng chủ động rút ngắn/kéo dài bằng backoff

    public static function delete(): self { return self::Delete; }
    public static function keep(): self   { return self::Keep; }
    public static function retry(): self  { return self::Retry; }

    public function isDelete(): bool { return $this === self::Delete; }
    public function isRetry(): bool  { return $this === self::Retry; }
}