<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Certificate extends Model
{
    use SoftDeletes;
    protected $fillable = [
        'reference',
        'participant',
        'email',
        'event',
        'status',
        'date_issued',
        'qr_code',
        // Delivery bookkeeping, written by the send job.
        'sent_at',
        'sent_to',
        'send_status',
        'send_error',
    ];

    public function getRouteKeyName(): string
    {
        return 'reference';
    }

    protected function casts(): array
    {
        return [
            'sent_at' => 'datetime',
        ];
    }
}
