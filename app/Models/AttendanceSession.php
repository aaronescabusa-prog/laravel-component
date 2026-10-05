<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One scheduled part of an event — normally Morning and Afternoon.
 *
 * Sessions hold the *planned* window; the actual punches live on Attendance.
 * Keeping the two apart is what lets a registrar correct a schedule after the
 * fact without rewriting history.
 */
class AttendanceSession extends Model
{
    protected $fillable = [
        'event_id',
        'label',
        'session_date',
        'time_in',
        'time_out',
        'grace_minutes',
        'status',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'session_date' => 'date:Y-m-d',
            'time_in' => 'string',
            'time_out' => 'string',
            'grace_minutes' => 'integer',
        ];
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    public function attendances(): HasMany
    {
        return $this->hasMany(Attendance::class);
    }

    /**
     * A closed session stops accepting punches, so a late scan at the door
     * cannot rewrite a session that has already been signed off.
     */
    public function isOpen(): bool
    {
        return $this->status !== 'closed';
    }

    /**
     * The moment attendance stops counting as on time.
     *
     * Built from the session date and the scheduled start rather than by
     * casting the bare time on its own: a 'HH:MM:SS' string carries no date, so
     * a bare datetime cast silently resolves against today and the threshold
     * drifts a day at a time. Returns null when no start is scheduled, since
     * without one there is nothing to be late for.
     */
    public function lateAfter(): ?CarbonImmutable
    {
        if (! $this->time_in) {
            return null;
        }

        $date = $this->session_date?->format('Y-m-d') ?? now()->format('Y-m-d');

        // A window may be stored as HH:MM or HH:MM:SS depending on what the
        // registrar typed. Trim to HH:MM so both land on a format that carries
        // the seconds createFromFormat would otherwise demand.
        $start = CarbonImmutable::createFromFormat('Y-m-d H:i', $date.' '.substr((string) $this->time_in, 0, 5));

        if (! $start) {
            return null;
        }

        return $start->addMinutes($this->grace_minutes ?: 0);
    }

    /**
     * The scheduled closing moment, or null when the session has no end.
     */
    public function closesAt(): ?CarbonImmutable
    {
        if (! $this->time_out) {
            return null;
        }

        $date = $this->session_date?->format('Y-m-d') ?? now()->format('Y-m-d');

        return CarbonImmutable::createFromFormat('Y-m-d H:i:s', $date.' '.$this->time_out);
    }
}