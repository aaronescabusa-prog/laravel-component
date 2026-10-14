<?php

namespace App\Services;

use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use App\Support\AcademicStructure;

class EventEligibility
{
    /**
     * Whether a registrant may submit a booking for the event.
     *
     * @return array{code: string, reason: ?string}
     */
    public function check(Event $event, ?UserAccount $account): array
    {
        $closedReason = $this->registrationClosedReason($event);
        if ($closedReason !== null) {
            return ['code' => 'registration_closed', 'reason' => $closedReason];
        }

        $reason = $this->failureFor($event, $account);

        if ($reason !== null) {
            return ['code' => 'ineligible', 'reason' => $reason];
        }

        if ($event->capacity !== null && $event->currentRegistrationCount() >= $event->capacity) {
            return ['code' => 'capacity', 'reason' => 'This event has reached its registration capacity.'];
        }

        if ($account) {
            $alreadyRegistered = Registration::query()
                ->where(function ($query) use ($event) {
                    $query->where('event_id', $event->getKey())
                        ->orWhere(function ($legacy) use ($event) {
                            $legacy->whereNull('event_id')
                                ->where('event', $event->title);
                        });
                })
                ->whereRaw('LOWER(email) = ?', [mb_strtolower(trim($account->email))])
                ->exists();

            if ($alreadyRegistered) {
                return ['code' => 'duplicate', 'reason' => 'This account is already registered for this event.'];
            }
        }

        return ['code' => 'ok', 'reason' => null];
    }

    public function failureFor(Event $event, ?UserAccount $account): ?string
    {
        if (($reason = $this->registrationClosedReason($event)) !== null) {
            return $reason;
        }

        $isTargeted = filled($event->target_course)
            || filled($event->target_department)
            || filled($event->target_year)
            || (filled($event->target_role) && $event->target_role !== 'All');

        if (! $isTargeted) {
            return null;
        }

        if (! $account || $account->status !== 'Active') {
            return 'An active TMC account is required to register for this targeted event.';
        }

        if (filled($event->target_role) && $event->target_role !== 'All' && $account->role !== $event->target_role) {
            return 'This event is restricted to the '.$event->target_role.' role.';
        }

        if (filled($event->target_department)
            && $account->department !== $event->target_department) {
            return 'This event is restricted to '.$event->target_department.' ('
                .(AcademicStructure::departmentName($event->target_department) ?? $event->target_department).').';
        }

        if (filled($event->target_course)
            && strcasecmp(trim((string) $account->course), trim((string) $event->target_course)) !== 0) {
            return 'This event is limited to '.$event->target_course.'.';
        }

        if (filled($event->target_year) && (string) $account->year !== (string) $event->target_year) {
            return 'This event is restricted to '.$event->target_year.'.';
        }

        return null;
    }

    private function registrationClosedReason(Event $event): ?string
    {
        if (! $event->registration_open) {
            return 'Registration for this event is closed.';
        }

        $today = now()->toDateString();

        if ($event->registration_deadline && $event->registration_deadline->format('Y-m-d') < $today) {
            return 'The registration deadline has passed.';
        }

        if ($event->event_date && $event->event_date->format('Y-m-d') < $today) {
            return 'Registration is closed because the event date has passed.';
        }

        return null;
    }
}
