<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class JobExecution extends Model
{
    protected $guarded = [];

    protected $casts = [
        'metadata_json' => 'array',
        'started_at'    => 'datetime',
        'finished_at'   => 'datetime',
    ];

    public function job(): BelongsTo
    {
        return $this->belongsTo(Job::class);
    }
}
