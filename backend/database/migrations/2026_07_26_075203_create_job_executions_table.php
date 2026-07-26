<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('job_executions', function (Blueprint $table) {
            $table->id();

            // Relationships
            $table->foreignId('job_id')
                ->constrained()
                ->cascadeOnDelete();

            // Execution information
            $table->unsignedTinyInteger('attempt'); // = SQS receive_count
            $table->string('worker_id', 100); // ECS container hostname
            $table->string('status', 20); // running | completed | failed

            // AWS metadata
            $table->string('ecs_task_arn')->nullable(); // Phase 3
            $table->string('sqs_receipt_handle', 1024)->nullable();

            // Execution time
            $table->timestamp('started_at');
            $table->timestamp('finished_at')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();

            // Error handling
            $table->string('error_code', 50)->nullable();
            $table->text('error_message')->nullable();

            // Additional metadata
            $table->json('metadata_json')->nullable();

            $table->timestamps();

            // Idempotency: cùng job + cùng lần nhận chỉ ghi một execution
            $table->unique(['job_id', 'attempt']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('job_executions');
    }
};
