<?php

namespace App\Models;

use App\Models\AttendanceSession;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Registration extends Model
{
    use SoftDeletes;
    protected $fillable = [
        'reference',
        'participant',
        'email',
        'role',
        'block_no',
        'event',
        'payment',
        'payment_status',
        'attendance',
        'reg_date',
        'qr_code',
    ];

    public function getRouteKeyName(): string
    {
        return 'reference';
    }

    /**
     * The owning event. Nullable because the column was backfilled from the
     * event *title*, and a registration whose event no longer exists is left
     * unattached rather than being guessed at.
     */
    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    /**
     * Alias for the event() relation that avoids the naming collision between
     * the BelongsTo and the `event` text column. Use this in jobs and mailables
     * that need the related Event model instance, e.g.:
     *   $registration->load('eventRelation');
     *   $registration->eventRelation->venue;
     */
    public function eventRelation(): BelongsTo
    {
        return $this->belongsTo(Event::class, 'event_id');
    }

    public function userAccount(): BelongsTo
    {
        return $this->belongsTo(UserAccount::class);
    }

    public function attendances(): HasMany
    {
        return $this->hasMany(Attendance::class);
    }

    /**
     * Whether every one of this registration's sessions carries both punches.
     *
     * This is the strict rule certificates depend on. A registration with no
     * sessions at all is not complete: an event nobody has been scheduled into
     * cannot be evidence of attendance.
     */
    public function hasCompleteAttendance(): bool
    {
        // Measure against every session the event has, not merely the rows
        // that happen to exist here. Counting existing rows would let someone
        // who was punched for the morning alone report as complete simply
        // because the afternoon left no row behind.
        //
        // Counted straight off the foreign key rather than through the event()
        // relation: this row also has an `event` text column holding the event
        // title, so `$this->event` yields that string and `event()` yields the
        // relation object rather than the related model.
        $expected = $this->event_id === null
            ? 0
            : AttendanceSession::where('event_id', $this->event_id)->count();

        if ($expected === 0) {
            return false;
        }

        $complete = $this->attendances()
            ->whereNotNull('time_in')
            ->whereNotNull('time_out')
            ->count();

        return $complete === $expected;
    }
}
