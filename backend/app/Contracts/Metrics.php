<?php

namespace App\Contracts;

interface Metrics {
    public function count(string $name, int $value = 1, array $dimensions = []): void;
    public function timing(string $name, int $milliseconds, array $dimensions = []): void;
}