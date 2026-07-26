<?php

namespace App\Queue;

use App\Exceptions\NonRetryableException;
use JsonSerializable;

final class JobMessage implements JsonSerializable
{
    public function __construct(
        public readonly string $jobId,
        public readonly string $jobType,
        public readonly array  $payload,
        public readonly int    $requestedBy,
        public readonly string $priority = 'normal',
        public readonly int    $messageVersion = 1,
    ) {}

    public function jsonSerialize(): array
    {
        return [
            'message_version' => $this->messageVersion,
            'job_id'          => $this->jobId,
            'job_type'        => $this->jobType,
            'priority'        => $this->priority,
            'payload'         => $this->payload,
            'requested_by'    => $this->requestedBy,
            'created_at'      => now()->toIso8601String(),
        ];
    }

    public static function fromArray(array $data): self
    {
        if (($data['message_version'] ?? 0) !== 1) {
            throw new NonRetryableException('Unsupported message_version');
        }

        foreach (['job_id', 'job_type', 'requested_by'] as $field) {
            if (! array_key_exists($field, $data)) {
                throw new NonRetryableException("Missing required field: {$field}");
            }
        }

        return new self(
            jobId:       $data['job_id'],
            jobType:     $data['job_type'],
            payload:     $data['payload'] ?? [],
            requestedBy: (int) $data['requested_by'],
            priority:    $data['priority'] ?? 'normal',
        );
    }
}
