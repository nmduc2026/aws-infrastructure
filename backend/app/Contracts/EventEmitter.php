<?php

namespace App\Contracts;

interface EventEmitter {
    public function emit(string $event, string $jobId, array $context = []): void;
}