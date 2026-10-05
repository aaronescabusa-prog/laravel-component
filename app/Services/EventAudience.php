<?php

namespace App\Services;

use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Registers the users an event's course audience covers.
 *
 * An event with no target_course is public: it is offered to everybody but is
 * not *aimed* at anyone, so nobody is enrolled on the strength of it. Only an
 * event that names a course has an audience, and that audience is every active
 * account in it.
 */
class EventAudience
{
    /**
     * Enrol the event's audience, skipping anyone already on the roster.
     *
     * Only ever adds. Narrowing an event from one course to another leaves the
     * previous course's registrations in place, because removing them would
     * destroy attendance that has already been recorded against them, and a
     * person may well have enrolled by hand after the event opened to
     * everybody. The trade-off is that a roster can hold students the event is
     * no longer aimed at; a registrar removes those deliberately if they want
     * them gone.
     *
     * @return array{target_course: ?string, matched: int, added: list<string>}
     */
    public function sync(Event $event): array
    {
        $course = trim((string) $event->target_course);

        if ($course === '') {
            return ['target_course' => null, 'matched' => 0, 'added' => []];
        }

        // Status rather than role decides who counts: an account that is still
        // Pending has not been cleared to take part in anything yet, while a
        // Staff or Organizer account is a legitimate participant in their own
        // course's event.
        $audience = UserAccount::query()
            ->where('status', 'Active')
            ->where('course', $course)
            ->orderBy('id')
            ->get();

        $added = [];

        DB::transaction(function () use ($event, $audience, &$added) {
            foreach ($audience as $account) {
                if ($this->alreadyRegistered($event, $account->email)) {
                    continue;
                }

                $added[] = $this->register($event, $account);
            }
        });

        return [
            'target_course' => $course,
            'matched' => $audience->count(),
            'added' => $added,
        ];
    }

    /**
     * Whether this email already holds a place on this event.
     *
     * Soft-deleted rows count. A registrar who removed someone has made a
     * deliberate choice, and re-enrolling them on the next save would quietly
     * undo it - the same reasoning as never removing anyone.
     *
     * Matched on the event id *or* the title, because registrations created
     * before the foreign key existed carry the title only.
     */
    protected function alreadyRegistered(Event $event, string $email): bool
    {
        return Registration::withTrashed()
            ->whereRaw('LOWER(email) = ?', [mb_strtolower(trim($email))])
            ->where(function ($query) use ($event) {
                $query->where('event_id', $event->id)
                    ->orWhere('event', $event->title);
            })
            ->exists();
    }

    /**
     * Add one account to the event's roster.
     *
     * The reference continues the existing REG-#### sequence rather than
     * numbering from the primary key, so identifiers stay uniform with the rows
     * registrars entered by hand.
     */
    protected function register(Event $event, UserAccount $account): string
    {
        try {
            return $this->insert($event, $account, $this->nextReference());
        } catch (QueryException $exception) {
            if (! $this->isDuplicateReference($exception)) {
                throw $exception;
            }
        }

        // The sequence is derived by reading the highest value in use, so two
        // event saves running at once could both settle on the same number and
        // the loser would collide on the unique index. Re-read and take the
        // next free one rather than failing the whole enrolment.
        return $this->insert($event, $account, $this->nextReference());
    }

    protected function insert(Event $event, UserAccount $account, string $reference): string
    {
        $registration = new Registration([
            'reference' => $reference,
            'participant' => $account->name,
            'email' => $account->email,
            'role' => $account->role ?: 'Student',
            'block_no' => $account->block_no,
            'event' => $event->title,
            // Nobody has paid for a place they were given, so there is no
            // payment to reconcile against.
            'payment' => 'Free',
            'payment_status' => 'N/A',
            'attendance' => 'Not Yet Recorded',
            'reg_date' => now()->format('Y-m-d'),
            'qr_code' => 'QR-'.strtoupper(bin2hex(random_bytes(5))),
        ]);

        // event_id is deliberately absent from $fillable so that no request can
        // attach a registration to an event other than the one it names. Here
        // the link is known-good because it comes from the event being saved.
        $registration->forceFill(['event_id' => $event->id]);
        $registration->save();

        return $registration->reference;
    }

    /**
     * The next unused REG-#### reference.
     */
    protected function nextReference(): string
    {
        $highest = Registration::withTrashed()
            ->where('reference', 'like', 'REG-%')
            ->pluck('reference')
            ->map(fn (string $reference) => (int) substr($reference, 4))
            ->filter(fn (int $number) => $number > 0)
            ->max() ?? 0;

        return 'REG-'.str_pad((string) $highest + 1, 4, '0', STR_PAD_LEFT);
    }

    protected function isDuplicateReference(QueryException $exception): bool
    {
        return ($exception->errorInfo[1] ?? null) === 1062;
    }
}
