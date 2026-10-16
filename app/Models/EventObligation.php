<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class EventObligation extends Model
{
    protected $fillable = [
        'event_id', 'user_account_id', 'student_reference', 'student_id', 'student_name',
        'student_email', 'department', 'course', 'year', 'block_no', 'status', 'finalized_at',
    ];

    protected function casts(): array
    {
        return ['finalized_at' => 'datetime'];
    }

    public function event(): BelongsTo { return $this->belongsTo(Event::class); }

    public function student(): BelongsTo { return $this->belongsTo(UserAccount::class, 'user_account_id'); }

    public function attendances(): HasMany { return $this->hasMany(ObligationAttendance::class); }

    public function fine(): HasOne { return $this->hasOne(StudentFine::class); }

    public function excuseRequests(): HasMany { return $this->hasMany(ExcuseRequest::class); }
}
