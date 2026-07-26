<?php

namespace App\Exceptions;

use RuntimeException;

/** Lỗi tạm thời — KHÔNG xóa message, để nó quay lại sau visibility timeout */
class RetryableException extends RuntimeException {}
