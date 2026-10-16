<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ExcuseRequest extends Model
{
    protected $fillable = [
        'event_obligation_id', 'user_account_id', 'reason', 'document_path', 'status',
        'reviewed_by_user_id', 'reviewed_at', 'review_note',
    ];

    protected function casts(): array
    {
        return ['reviewed_at' => 'datetime'];
    }

    public function obligation(): BelongsTo { return $this->belongsTo(EventObligation::class, 'event_obligation_id'); }

    public function student(): BelongsTo { return $this->belongsTo(UserAccount::class, 'user_account_id'); }
}
