<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class JobExecutionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'             => $this->id,
            'attempt'        => $this->attempt,
            'worker_id'      => $this->worker_id,
            'status'         => $this->status,
            'started_at'     => $this->started_at?->toIso8601String(),
            'finished_at'    => $this->finished_at?->toIso8601String(),
            'duration_ms'    => $this->duration_ms,
            'error_code'     => $this->error_code,
            'error_message'  => $this->error_message,
        ];
    }
}
