<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreJobRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'type'     => ['required', 'string', Rule::in(['simulate_work', 'generate_report', 'send_email'])],
            'priority' => ['sometimes', 'string', Rule::in(['normal', 'high', 'low'])],
            'payload'  => ['required', 'array'],
            'payload.notify' => ['sometimes', 'boolean'],
            // Laravel validated() chỉ trả về key có rule — khai báo đủ để payload không bị cắt.
            // max phải nhỏ hơn TASKFLOW_VISIBILITY_TIMEOUT, nếu không message
            // hiện lại giữa chừng và bị worker thứ hai nhận trong khi job còn chạy.
            'payload.duration_seconds'    => ['sometimes', 'integer', 'min:1', 'max:60'],
            'payload.failure_probability' => ['sometimes', 'numeric', 'min:0', 'max:1'],
            'payload.failure_type'        => ['sometimes', 'string', Rule::in(['retryable', 'non_retryable'])],
            'payload.record_count'        => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'payload.format'              => ['sometimes', 'string', Rule::in(['csv'])],
            'payload.to'                  => ['sometimes', 'email'],
            'payload.subject'             => ['sometimes', 'string', 'max:255'],
            'payload.body'                => ['sometimes', 'string'],
        ];
    }
}
