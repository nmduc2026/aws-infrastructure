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
        Schema::create('job_queue_messages', function (Blueprint $table) {
            $table->id();

            // Queue information
            $table->string('queue_name', 80)->index(); // taskflow-jobs | taskflow-jobs-dlq
            $table->json('body');

            // Message state
            $table->string('receipt_handle', 64)->nullable();
            $table->unsignedTinyInteger('receive_count')->default(0);
            $table->timestamp('visible_at')->useCurrent(); // Message sẽ "ẩn" đến thời điểm này

            // Timestamps
            $table->timestamp('created_at')->useCurrent();

            // Indexes
            $table->index(['queue_name', 'visible_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('job_queue_messages');
    }
};
