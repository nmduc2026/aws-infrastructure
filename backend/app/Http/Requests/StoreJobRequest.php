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
      ];
    }
}
