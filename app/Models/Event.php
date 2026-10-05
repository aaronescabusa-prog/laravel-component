<?php

namespace App\Models;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class Event extends Model
{
    use SoftDeletes;
    protected $fillable = [
        'reference',
        'title',
        'category',
        'organizer',
        'event_date',
        'start_time',
        'end_date',
        'end_time',
        'duration_value',
        'duration_unit',
        'venue',
        'description',
        'budget',
        'capacity',
        'participants',
        'status',
        'target_role',
        'target_course',
        'has_certificate',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $event) {
            // Every event needs its QR target the moment it exists. The
            // migration only backfills rows that already existed, so events
            // created since — through the API, a seeder or a test — would
            // otherwise have no token and no printable poster.
            if (blank($event->checkin_token)) {
                $event->checkin_token = static::generateCheckinToken();
            }
        });
    }

    /**
     * A random token naming the event to the check-in screen.
     *
     * This identifies the event and nothing more. It is never an authorisation
     * credential: every check-in endpoint still sits behind an authenticated
     * account, the active check and the registrations role, so a photographed
     * poster cannot be used to mark a roster.
     */
    private static function generateCheckinToken(): string
    {
        do {
            $token = bin2hex(random_bytes(16));
        } while (static::withTrashed()->where('checkin_token', $token)->exists());

        return $token;
    }

    public function getRouteKeyName(): string
    {
        return 'reference';
    }

    protected function casts(): array
    {
        return [
            'event_date' => 'date:Y-m-d',
            'end_date' => 'date:Y-m-d',
            'duration_value' => 'integer',
            'budget' => 'integer',
            'capacity' => 'integer',
            'participants' => 'integer',
            'has_certificate' => 'boolean',
        ];
    }

    /**
     * Units accepted for the event duration.
     */
    public const DURATION_UNITS = ['Hours', 'Days'];

    /**
     * Courses an event's visibility can be limited to.
     *
     * A fixed catalogue rather than the distinct courses found on user accounts:
     * a course exists whether or not anybody is enrolled in it yet, so a new
     * course must be offerable before its first student arrives. An event with
     * no target_course is offered to all courses.
     */
    public const COURSES = [
        'BS Information Technology',
        'BS Criminology',
        'BS Office Administration',
        'BS Education Major in English',
        'Bachelor of Elementary Education',
        'BA Political Science',
        'BA Communications',
    ];

    /**
     * Human readable duration, e.g. "8 hours" or "3 days".
     *
     * Returns null when no duration was recorded. The unit is pluralised only
     * for the singular form so "1 day" reads correctly next to "2 days".
     */
    public function durationLabel(): ?string
    {
        if ($this->duration_value === null || $this->duration_value === 0) {
            return null;
        }

        $unit = $this->duration_unit ?: 'Hours';
        $label = $unit === 'Days' ? 'day' : 'hour';

        return $this->duration_value.' '.($this->duration_value === 1 ? $label : $label.'s');
    }

    /**
     * Whether the event is capped, i.e. carries a capacity at all.
     *
     * Derived rather than stored so the toggle and the number cannot drift
     * apart: the one piece of truth is whether a capacity has been entered.
     */
    public function hasCapacity(): bool
    {
        return $this->capacity !== null;
    }

    /**
     * Human readable course audience, or null when the event is public.
     */
    public function audienceLabel(): ?string
    {
        return $this->target_course ?: null;
    }

    /**
     * Whether the event runs all day, i.e. carries no start or end time.
     */
    public function isAllDay(): bool
    {
        return ! $this->start_time && ! $this->end_time;
    }

    /**
     * Work out the event's length from where it starts and ends.
     *
     * end_date/end_time are the source of truth; duration_value/duration_unit
     * are kept in step with them so listings and reports can sort and filter on
     * a number without re-parsing the range.
     *
     * Rules, chosen so the result is always at least one whole unit:
     *   - No start or end date: nothing to derive.
     *   - Same day with both times: hours, rounded up. An end time at or before
     *     the start is read as running past midnight.
     *   - Same day without times, or spanning more than one day: days, counting
     *     the end date inclusively (a Mon-Thu event is 4 days).
     *
     * @return array{0: int|null, 1: string|null} [duration_value, duration_unit]
     */
    public function deriveDuration(): array
    {
        if (! $this->event_date || ! $this->end_date) {
            return [null, null];
        }

        $start = Carbon::parse($this->event_date->format('Y-m-d'));
        $end = Carbon::parse($this->end_date->format('Y-m-d'));

        if ($start->isSameDay($end)) {
            if ($this->start_time && $this->end_time) {
                $from = Carbon::parse($start->format('Y-m-d').' '.$this->start_time);
                $to = Carbon::parse($start->format('Y-m-d').' '.$this->end_time);

                // An end that is not after the start has rolled past midnight.
                if ($to->lessThanOrEqualTo($from)) {
                    $to = $to->addDay();
                }

                return [max(1, (int) ceil($from->diffInMinutes($to) / 60)), 'Hours'];
            }

            return [1, 'Days'];
        }

        return [$start->diffInDays($end) + 1, 'Days'];
    }

    /**
     * Recalculate the duration from the current start/end range.
     *
     * Only marks the attribute dirty when it actually changed, so saving an
     * event without touching its schedule does not force a pointless UPDATE.
     */
    public function syncDuration(): void
    {
        [$value, $unit] = $this->deriveDuration();

        if ($this->duration_value !== $value || $this->duration_unit !== $unit) {
            $this->duration_value = $value;
            $this->duration_unit = $unit;
        }
    }

    public function registrations(): HasMany
    {
        return $this->hasMany(Registration::class);
    }

    public function certificates(): HasMany
    {
        return $this->hasMany(Certificate::class);
    }

    public function template(): HasOne
    {
        return $this->hasOne(CertificateTemplate::class);
    }

    /**
     * Ordered so Morning precedes Afternoon without every caller having to
     * sort, and so a caller can rely on the order across pages.
     */
    public function attendanceSessions(): HasMany
    {
        return $this->hasMany(AttendanceSession::class)
            ->orderBy('session_date')
            ->orderBy('id');
    }
}
