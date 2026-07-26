<?php

namespace App\Exceptions;

use RuntimeException;

/** Người dùng bấm Cancel — XÓA message, status = cancelled */
class JobCancelledException extends RuntimeException {}
