<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Job extends Model
{
    // Bảng `jobs` có created_at do migration tự đặt useCurrent, không có updated_at
    public $timestamps = false;

    protected $guarded = [];

    // payload_json / result_json là cột JSON — cast để đọc ghi bằng array PHP.
    // Thiếu cast thì $job->payload_json trả về chuỗi và handler sẽ vỡ.
    protected $casts = [
        'payload_json'     => 'array',
        'result_json'      => 'array',
        'cancel_requested' => 'boolean',
        'notify'           => 'boolean',
        'created_at'       => 'datetime',
        'queued_at'        => 'datetime',
        'started_at'       => 'datetime',
        'completed_at'     => 'datetime',
        'failed_at'        => 'datetime',
        'heartbeat_at'     => 'datetime',
    ];

    // ULID là ID công khai — mọi route dùng nó thay cho id tự tăng
    public function getRouteKeyName(): string
    {
        return 'ulid';
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function executions(): HasMany
    {
        return $this->hasMany(JobExecution::class)->orderBy('attempt');
    }
}
