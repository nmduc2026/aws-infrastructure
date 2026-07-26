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
        Schema::create('jobs', function (Blueprint $table) {
            $table->id();
            $table->ulid('ulid')->unique(); // Public ID dùng trong message, log, URL

            // Relationships
            $table->foreignId('user_id')
                ->constrained()
                ->cascadeOnDelete();

            // Job information
            $table->string('type', 50); // simulate_work | generate_report | send_email
            $table->string('status', 20)->default('queued');
            $table->string('priority', 10)->default('normal');

            // Payload & result
            $table->json('payload_json');
            $table->unsignedTinyInteger('progress')->default(0); // 0..100
            $table->json('result_json')->nullable();
            $table->string('result_s3_key', 512)->nullable(); // Phase 3

            // Future phases (khai báo trước để tránh ALTER TABLE)
            $table->boolean('cancel_requested')->default(false); // Phase 1
            $table->timestamp('heartbeat_at')->nullable(); // Phase 4
            $table->boolean('notify')->default(true); // Phase 5

            // Error handling
            $table->string('error_code', 50)->nullable();
            $table->text('error_message')->nullable();
            $table->unsignedTinyInteger('attempts')->default(0);

            // Timestamps
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('queued_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('failed_at')->nullable();

            // Indexes
            $table->index(['status', 'created_at']); // Maintenance quét job treo
            $table->index(['user_id', 'created_at']); // Danh sách job của user
            $table->index('type');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('jobs');
    }
};
