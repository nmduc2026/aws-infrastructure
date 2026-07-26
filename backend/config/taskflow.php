<?php
return [
    'queue_driver'   => env('TASKFLOW_QUEUE_DRIVER', 'database'),
    'event_driver'   => env('TASKFLOW_EVENT_DRIVER', 'log'),
    'storage_driver' => env('TASKFLOW_STORAGE_DRIVER', 'local'),
    // Dotenv biến chữ null không có nháy trong .env thành PHP null, không phải
    // chuỗi 'null' -> dùng ?: để lấy lại giá trị mặc định.
    'metrics_driver' => env('TASKFLOW_METRICS_DRIVER') ?: 'null',

    'queues' => [
        'jobs'              => env('TASKFLOW_QUEUE_JOBS', 'taskflow-jobs'),
        'jobs_dlq'          => env('TASKFLOW_QUEUE_JOBS_DLQ', 'taskflow-jobs-dlq'),
        'notifications'     => env('TASKFLOW_QUEUE_NOTIFICATIONS', 'taskflow-notifications'),
    ],

    'visibility_timeout' => (int) env('TASKFLOW_VISIBILITY_TIMEOUT', 180),
    'max_receive_count'  => (int) env('TASKFLOW_MAX_RECEIVE_COUNT', 3),
    'worker_timeout'     => (int) env('TASKFLOW_WORKER_TIMEOUT', 150),
    'heartbeat_interval' => (int) env('TASKFLOW_HEARTBEAT_INTERVAL', 60),

    'aws' => [
        'region'     => env('AWS_DEFAULT_REGION', 'us-east-1'),
        'account_id' => env('AWS_ACCOUNT_ID'),
    ],
];