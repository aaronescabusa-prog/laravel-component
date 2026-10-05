<?php

namespace App\Mail;

use App\Models\Certificate;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Storage;
use Barryvdh\DomPDF\Facade\Pdf;

/**
 * Sends a rendered certificate PDF to the student as an attachment.
 *
 * The PDF is attached rather than linked so the student always receives a file
 * they can print or save, even if the server is later moved or the link expires.
 */
class CertificateMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public Certificate $certificate,
        public string $pdfPath,
    ) {
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Your certificate for '.$this->certificate->event,
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'certificates.mail',
            with: [
                'certificate' => $this->certificate,
            ],
        );
    }

    /**
     * Attach the rendered PDF from the public disk.
     */
    public function attachments(): array
    {
        $disk = Storage::disk('public');

        if (! $disk->exists($this->pdfPath)) {
            \Illuminate\Support\Facades\Log::warning('CertificateMail: PDF attachment missing', [
                'certificate_id' => $this->certificate->id,
                'reference' => $this->certificate->reference,
                'pdf_path' => $this->pdfPath,
            ]);

            return [];
        }

        $name = $this->certificate->reference.'.pdf';

        return [
            // fromData() expects a Closure so the bytes are read lazily, at
            // send time, rather than held in memory while the queue waits.
            Attachment::fromData(
                fn () => $disk->get($this->pdfPath),
                $name,
                ['mime' => 'application/pdf'],
            ),
        ];
    }
}