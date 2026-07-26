<?php

namespace App\Metrics;

use App\Contracts\Metrics;

final class NullMetrics implements Metrics {
    public function count(string $n, int $v = 1, array $d = []): void {}
    public function timing(string $n, int $ms, array $d = []): void {}
}