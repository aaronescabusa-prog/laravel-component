<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One participant's punches inside one session.
 *
 * `time_in` and `time_out` are the measured moments; `status` is the derived
 * verdict used everywhere else. Strict certificate eligibility requires both
 * punches to be present on every session of the event, which is why
 * isComplete() exists rather than callers checking the columns by hand.
 */
class Attendance extends Model
{
    public const NOT_RECORDED = 'Not Yet Recorded';

    public const PRESENT = 'Present';

    public const LATE = 'Late';

    public const ABSENT = 'Absent';

    public const EXCUSED = 'Excused';

    protected $fillable = [
        'attendance_session_id',
        'registration_id',
        'time_in',
        'time_out',
        'status',
        'recorded_at',
        'recorded_by',
    ];

    protected function casts(): array
    {
        return [
            'time_in' => 'datetime',
            'time_out' => 'datetime',
            'recorded_at' => 'datetime',
        ];
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(AttendanceSession::class, 'attendance_session_id');
    }

    public function registration(): BelongsTo
    {
        return $this->belongsTo(Registration::class);
    }

    /**
     * Both punches recorded, which is what strict eligibility demands.
     */
    public function isComplete(): bool
    {
        return $this->time_in !== null && $this->time_out !== null;
    }

    /**
     * Whether a given moment counts as late against the session schedule.
     *
     * When the session has no scheduled start there is nothing to be late
     * for, so an arrival is simply on time.
     */
    public function isLateAt(CarbonImmutable $moment): bool
    {
        $threshold = $this->session?->lateAfter();

        return $threshold !== null && $moment > $threshold;
    }
}