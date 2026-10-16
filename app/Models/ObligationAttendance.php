<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ObligationAttendance extends Model
{
    protected $fillable = [
        'event_obligation_id', 'attendance_session_id', 'time_in', 'time_out',
        'status', 'recorded_by_user_id', 'recorded_at',
    ];

    protected function casts(): array
    {
        return ['time_in' => 'datetime', 'time_out' => 'datetime', 'recorded_at' => 'datetime'];
    }

    public function obligation(): BelongsTo { return $this->belongsTo(EventObligation::class, 'event_obligation_id'); }

    public function session(): BelongsTo { return $this->belongsTo(AttendanceSession::class, 'attendance_session_id'); }
}
