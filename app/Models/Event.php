<?php

namespace App\Models;

use App\Support\AcademicStructure;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Event extends Model
{
    use SoftDeletes;

    protected $hidden = ['checkin_token'];

    protected $fillable = [
        'reference',
        'title',
        'category',
        'organizer',
        'organizer_user_id',
        'event_date',
        'registration_deadline',
        'registration_open',
        'start_time',
        'end_date',
        'end_time',
        'duration_value',
        'duration_unit',
        'venue',
        'description',
        'banner_url',
        'budget',
        'capacity',
        'participants',
        'status',
        'target_role',
        'target_course',
        'target_department',
        'target_year',
        'target_block',
        'has_certificate',
        'penalty_type',
        'penalty_amount',
        'attendance_compulsory',
        'attendance_requires_checkout',
        'absence_fine_amount',
        'incomplete_fine_amount',
        'attendance_correction_deadline',
        'excuse_deadline',
        'attendance_roster_finalized_at',
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
            'registration_deadline' => 'date:Y-m-d',
            'registration_open' => 'boolean',
            'end_date' => 'date:Y-m-d',
            'duration_value' => 'integer',
            'budget' => 'integer',
            'capacity' => 'integer',
            'participants' => 'integer',
            'has_certificate' => 'boolean',
            'penalty_type' => 'string',
            'penalty_amount' => 'integer',
            'attendance_compulsory' => 'boolean',
            'attendance_requires_checkout' => 'boolean',
            'absence_fine_amount' => 'decimal:2',
            'incomplete_fine_amount' => 'decimal:2',
            'attendance_correction_deadline' => 'datetime',
            'excuse_deadline' => 'datetime',
            'attendance_roster_finalized_at' => 'datetime',
        ];
    }

    /**
     * Units accepted for the event duration.
     */
    public const DURATION_UNITS = ['Hours', 'Days'];

    /**
     * The program catalogue used for event audience targeting.
     *
     * A fixed catalogue rather than the distinct courses found on user accounts:
     * a course exists whether or not anybody is enrolled in it yet, so a new
     * course must be offerable before its first student arrives. The optional
     * department, year, and role criteria further narrow this program audience.
     */
    public const COURSES = AcademicStructure::COURSES;

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
        $audiences = array_filter([
            $this->target_department
                ? $this->target_department.' ('.(AcademicStructure::departmentName($this->target_department) ?? $this->target_department).')'
                : null,
            $this->target_course,
            $this->target_year ? 'Year '.$this->target_year : null,
            $this->target_role && $this->target_role !== 'All' ? $this->target_role : null,
        ]);

        return $audiences === [] ? null : implode(' · ', $audiences);
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
     *   - No start or end date: nothing to derive (the event may still be open-ended).
     *   - Same day with both times: hours, rounded up. An end time at or before
     *     the start is read as running past midnight.
     *   - Same day without times, or spanning more than one day: days, counting
     *     the end date inclusively (a Mon-Thu event is 4 days).
     *
     * @return array{0: int|null, 1: string|null} [duration_value, duration_unit]
     */
    public function deriveDuration(): array
    {
        if (! $this->event_date) {
            return [null, null];
        }

        // A start date alone is an unfinished schedule. All-day durations are
        // derived only after an end date has been entered.
        if (! $this->end_date) {
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

    public function organizerAccount(): BelongsTo
    {
        return $this->belongsTo(UserAccount::class, 'organizer_user_id');
    }

    public function scannerAccounts(): BelongsToMany
    {
        return $this->belongsToMany(UserAccount::class, 'event_scanners')
            ->withPivot('assigned_by')
            ->withTimestamps();
    }

    public function certificates(): HasMany
    {
        return $this->hasMany(Certificate::class);
    }

    public function attendanceObligations(): HasMany
    {
        return $this->hasMany(EventObligation::class);
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

    /**
     * Count current registrations, including older rows linked by title only.
     */
    public function currentRegistrationCount(): int
    {
        return Registration::query()
            ->where(function ($query) {
                $query->where('event_id', $this->getKey())
                    ->orWhere(function ($legacy) {
                        $legacy->whereNull('event_id')->where('event', $this->title);
                    });
            })
            ->count();
    }

    public function syncParticipantCount(?int $count = null): void
    {
        $count ??= $this->currentRegistrationCount();

        if ((int) $this->participants !== $count) {
            $this->forceFill(['participants' => $count])->saveQuietly();
        }
    }
}
