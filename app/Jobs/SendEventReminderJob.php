<?php

namespace App\Jobs;

use App\Mail\EventReminderMail;
use App\Models\Event;
use App\Models\Registration;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Sends a single event-reminder email with a .ics calendar attachment.
 *
 * Dispatched once per registration by the SendEventReminders artisan command,
 * which runs daily at 08:00 and targets events whose event_date is tomorrow.
 *
 * Follows the same queue/retry conventions as SendCertificateMail:
 * - default queue (no named queue — see SendCertificateMail for the reason)
 * - three attempts before marking failed
 * - 60-second back-off between retries
 */
class SendEventReminderJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $backoff = 60;
    public int $timeout = 90;

    public function __construct(
        public Registration $registration,
        public Event $event,
    ) {
    }

    public function handle(): void
    {
        // Ensure the related Event model is present (may be absent when the job
        // is reconstructed from the queue without eager loading).
        $this->registration->loadMissing('eventRelation');

        $ics = $this->buildIcs();

        Mail::to($this->registration->email)
            ->send(new EventReminderMail($this->registration, $ics));

        Log::info('EventReminder sent', [
            'registration' => $this->registration->reference,
            'event'        => $this->event->title,
            'email'        => $this->registration->email,
        ]);
    }

    public function failed(\Throwable $e): void
    {
        Log::error('SendEventReminderJob failed', [
            'registration' => $this->registration->reference,
            'event'        => $this->event->title,
            'error'        => $e->getMessage(),
        ]);
    }

    // -------------------------------------------------------------------------

    /**
     * Build a minimal, spec-compliant iCalendar string for the event.
     *
     * The generated VEVENT carries:
     *  - UID  — unique per registration so each attendee gets their own invite
     *  - DTSTART / DTEND — derived from event_date + start_time / end_time
     *  - LOCATION — event venue
     *  - DESCRIPTION — includes the participant's personal QR code value
     */
    public function buildIcs(): string
    {
        $event = $this->event;
        $reg   = $this->registration;

        $uid = 'reminder-'.$reg->reference.'@eventease';

        // Date + time handling: fall back to all-day when no times are set.
        $date      = $event->event_date instanceof \Carbon\Carbon
            ? $event->event_date
            : \Carbon\Carbon::parse($event->event_date);

        $startStr  = $event->start_time
            ? $date->copy()->setTimeFromTimeString($event->start_time)->format('Ymd\THis')
            : $date->format('Ymd');

        $endDate   = $event->end_date
            ? (\Carbon\Carbon::parse($event->end_date))
            : $date->copy();

        $endStr    = $event->end_time
            ? $endDate->setTimeFromTimeString($event->end_time)->format('Ymd\THis')
            : ($event->start_time
                ? $date->copy()->setTimeFromTimeString($event->start_time)->addHour()->format('Ymd\THis')
                : $endDate->addDay()->format('Ymd'));

        $dtFmt     = $event->start_time ? 'DTSTART' : 'DTSTART;VALUE=DATE';
        $dtEndFmt  = $event->end_time   ? 'DTEND'   : 'DTEND;VALUE=DATE';

        $summary     = $this->icsEscape($event->title);
        $location    = $this->icsEscape($event->venue ?? '');
        $description = $this->icsEscape(
            "You are registered for {$event->title}.\n"
            ."Check-in QR: {$reg->qr_code}\n"
            ."Participant: {$reg->participant}"
        );

        $now = now()->format('Ymd\THis\Z');

        return implode("\r\n", [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//TMC EventEase//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'BEGIN:VEVENT',
            "UID:{$uid}",
            "DTSTAMP:{$now}",
            "{$dtFmt}:{$startStr}",
            "{$dtEndFmt}:{$endStr}",
            "SUMMARY:{$summary}",
            "LOCATION:{$location}",
            "DESCRIPTION:{$description}",
            'STATUS:CONFIRMED',
            'END:VEVENT',
            'END:VCALENDAR',
            '',   // trailing CRLF required by RFC 5545
        ]);
    }

    /** Escape special characters as required by RFC 5545 §3.3.11. */
    private function icsEscape(string $value): string
    {
        return str_replace(
            ['\\', ';', ',', "\n"],
            ['\\\\', '\;', '\,', '\n'],
            $value
        );
    }
}
