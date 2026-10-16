<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StudentFine extends Model
{
    protected $fillable = [
        'event_obligation_id', 'amount', 'reason', 'assessment_status', 'payment_status',
        'amount_paid', 'reviewed_by_user_id', 'reviewed_at', 'review_note',
    ];

    protected function casts(): array
    {
        return ['amount' => 'decimal:2', 'amount_paid' => 'decimal:2', 'reviewed_at' => 'datetime'];
    }

    public function obligation(): BelongsTo { return $this->belongsTo(EventObligation::class, 'event_obligation_id'); }

    public function payments(): HasMany { return $this->hasMany(FinePayment::class); }
}
