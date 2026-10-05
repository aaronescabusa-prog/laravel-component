<?php

namespace App\Mail;

use App\Models\Registration;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Sends a 24-hour event reminder to a registered participant.
 *
 * The email includes event details (venue, date/time) and the participant's
 * personal check-in QR code. A calendar invite (.ics) is attached so the
 * participant can add the event to Google Calendar, Apple Calendar, Outlook, etc.
 */
class EventReminderMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public Registration $registration,
        public string $icsContent,
    ) {
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Reminder: '.$this->registration->event.' is tomorrow',
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.event-reminder',
            with: [
                'registration' => $this->registration,
                'event'        => $this->registration->eventRelation,
            ],
        );
    }

    public function attachments(): array
    {
        $safeTitle = preg_replace('/[^A-Za-z0-9_\-]/', '_', $this->registration->event);

        return [
            Attachment::fromData(
                fn () => $this->icsContent,
                "{$safeTitle}.ics",
                ['mime' => 'text/calendar'],
            ),
        ];
    }
}
