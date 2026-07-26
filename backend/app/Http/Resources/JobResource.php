<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class JobResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'ulid'             => $this->ulid,
            'type'             => $this->type,
            'status'           => $this->status,
            'priority'         => $this->priority,
            'progress'         => $this->progress,
            'payload_json'     => $this->payload_json ?? [],
            'result_json'      => $this->result_json,
            'error_code'       => $this->error_code,
            'error_message'    => $this->error_message,
            'attempts'         => $this->attempts,
            'cancel_requested' => $this->cancel_requested,
            'created_at'       => $this->created_at?->toIso8601String(),
            'queued_at'        => $this->queued_at?->toIso8601String(),
            'started_at'       => $this->started_at?->toIso8601String(),
            'completed_at'     => $this->completed_at?->toIso8601String(),
            'failed_at'        => $this->failed_at?->toIso8601String(),
            'executions'       => JobExecutionResource::collection(
                $this->whenLoaded('executions')
            ),
        ];
    }
}
