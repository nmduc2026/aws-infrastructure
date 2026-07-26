<?php

namespace App\Queue;

final class ReceivedMessage
{
    public function __construct(
        public readonly string $receiptHandle,
        public readonly int    $receiveCount,
        public readonly array  $body,
    ) {}

    public function toJobMessage(): JobMessage
    {
        return JobMessage::fromArray($this->body);
    }
}