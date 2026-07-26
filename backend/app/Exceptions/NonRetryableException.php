<?php

namespace App\Exceptions;

use RuntimeException;

/** Lỗi vĩnh viễn — XÓA message ngay, retry không giúp được gì */
class NonRetryableException extends RuntimeException {}
