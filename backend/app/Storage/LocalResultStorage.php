<?php

namespace App\Storage;

use App\Contracts\ResultStorage;
use Illuminate\Support\Facades\Storage;

final class LocalResultStorage implements ResultStorage {
    public function put(string $key, string $contents): string {
        Storage::disk('local')->put($key, $contents);
        return $key;
    }
    public function temporaryUrl(string $key, int $minutes = 15): string {
        return url("/api/files/{$key}");   // Phase 3 đổi thành pre-signed S3 URL
    }
}