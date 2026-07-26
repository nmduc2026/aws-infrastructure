<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\JobController;
use App\Http\Controllers\LoadTestController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/login',    [AuthController::class, 'login']);
Route::post('/auth/register', [AuthController::class, 'register']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me',      [AuthController::class, 'me']);

    Route::get('/jobs',              [JobController::class, 'index']);
    Route::post('/jobs',             [JobController::class, 'store']);
    Route::get('/jobs/{ulid}',       [JobController::class, 'show']);
    Route::post('/jobs/{ulid}/retry',  [JobController::class, 'retry']);
    Route::post('/jobs/{ulid}/cancel', [JobController::class, 'cancel']);

    Route::get('/dashboard/summary', [DashboardController::class, 'summary']);
    Route::post('/load-tests',       [LoadTestController::class, 'store']);

    // DLQ có UI riêng từ Phase 6. Ở Phase 1 xem trực tiếp bảng job_queue_messages.
    // Route::get('/dlq',                  [DlqController::class, 'index']);
    // Route::post('/dlq/{ulid}/redrive',  [DlqController::class, 'redrive']);
});
