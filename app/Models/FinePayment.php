<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FinePayment extends Model
{
    protected $fillable = [
        'student_fine_id', 'amount', 'receipt_reference', 'method', 'paid_at', 'recorded_by_user_id', 'note',
    ];

    protected function casts(): array
    {
        return ['amount' => 'decimal:2', 'paid_at' => 'datetime'];
    }

    public function fine(): BelongsTo { return $this->belongsTo(StudentFine::class, 'student_fine_id'); }
}
