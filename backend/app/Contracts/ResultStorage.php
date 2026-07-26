<?php

namespace App\Contracts;

interface ResultStorage {
    public function put(string $key, string $contents): string;   // trả về key
    public function temporaryUrl(string $key, int $minutes = 15): string;
}